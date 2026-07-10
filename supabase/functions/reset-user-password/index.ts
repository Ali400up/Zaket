import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const { data: profile, error: profileError } = await caller
      .from("profiles")
      .select("role,is_active")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !profile?.is_active || profile.role !== "admin") {
      return json({ error: "هذه العملية متاحة لمدير النظام فقط." }, 403);
    }

    const body = await req.json();
    const userId = String(body.user_id || "").trim();
    const password = String(body.password || "");
    if (!userId) return json({ error: "معرف المستخدم مطلوب." }, 400);
    if (password.length < 8) return json({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);

    return json({ id: data.user.id, message: "تمت إعادة تعيين كلمة المرور بنجاح." });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "خطأ غير متوقع." }, 500);
  }
});
