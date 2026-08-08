import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-fingerprint",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "إعدادات الخادم غير مكتملة." }, 500);

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "يجب تسجيل الدخول." }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user) return json({ error: "الجلسة غير صالحة." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const fingerprint = String(req.headers.get("x-device-fingerprint") ?? "").trim();
    if (!fingerprint) return json({ error: "بصمة الجهاز مطلوبة." }, 403);
    const { data: approvedDevice, error: deviceError } = await admin
      .from("authorized_devices")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("fingerprint", fingerprint)
      .eq("status", "approved")
      .eq("is_active", true)
      .maybeSingle();
    if (deviceError || !approvedDevice) return json({ error: "هذا الجهاز غير معتمد لتنفيذ العملية." }, 403);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role,is_active,status,expires_at")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !profile?.is_active || profile.status !== "active" || profile.role !== "admin" || (profile.expires_at && profile.expires_at < new Date().toISOString().slice(0, 10))) {
      return json({ error: "هذه العملية متاحة لمدير النظام فقط." }, 403);
    }

    const body = await req.json();
    const userId = String(body.user_id || "").trim();
    const password = String(body.password || "");
    if (!userId) return json({ error: "معرف المستخدم مطلوب." }, 400);
    if (password.length < 8) return json({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف." }, 400);

    const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);

    const { error: auditError } = await admin.from("audit_logs").insert({
      user_id: authData.user.id,
      action: "reset_password",
      table_name: "profiles",
      record_id: userId,
      new_data: { password_changed: true },
      session_info: { device_fingerprint: fingerprint, source: "reset-user-password-edge-function" },
      result: "success",
    });
    if (auditError) console.error("تعذر تسجيل تدقيق إعادة كلمة المرور", auditError);

    return json({ id: data.user.id, message: "تمت إعادة تعيين كلمة المرور بنجاح." });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "خطأ غير متوقع." }, 500);
  }
});
