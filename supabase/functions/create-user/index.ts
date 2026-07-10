import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set([
  "admin", "supervisor", "accountant", "distributor", "data_entry", "warehouse", "auditor",
]);

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
    const fullName = String(body.full_name || "").trim();
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "data_entry");
    if (fullName.length < 3) return json({ error: "الاسم الكامل مطلوب." }, 400);
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) return json({ error: "اسم المستخدم غير صالح." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "البريد الإلكتروني غير صالح." }, 400);
    if (password.length < 8) return json({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف." }, 400);
    if (!allowedRoles.has(role)) return json({ error: "الدور الوظيفي غير صالح." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username },
    });
    if (createError || !created.user) return json({ error: createError?.message || "تعذر إنشاء المستخدم." }, 400);

    const { error: updateError } = await admin.from("profiles").update({
      full_name: fullName,
      username,
      email,
      phone: body.phone || null,
      role,
      is_active: body.is_active !== false,
      expires_at: body.expires_at || null,
      notes: body.notes || null,
    }).eq("id", created.user.id);

    if (updateError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: updateError.message }, 400);
    }

    return json({
      id: created.user.id,
      email,
      username,
      message: "تم إنشاء المستخدم بنجاح.",
    }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "خطأ غير متوقع." }, 500);
  }
});
