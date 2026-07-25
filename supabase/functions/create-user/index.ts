import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizePhone(value: unknown) {
  let phone = String(value ?? "").trim().replace(/[^0-9+]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (phone.startsWith("+9670")) phone = `+967${phone.slice(5)}`;
  else if (phone.startsWith("9670")) phone = `+967${phone.slice(4)}`;
  else if (phone.startsWith("967")) phone = `+${phone}`;
  else if (!phone.startsWith("+")) phone = `+967${phone.replace(/^0+/, "")}`;
  return phone;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مسموحة." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "إعدادات الخادم غير مكتملة." }, 500);

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "يجب تسجيل الدخول أولاً." }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: me, error: meError } = await caller.auth.getUser();
    if (meError || !me.user) return json({ error: "الجلسة غير صالحة." }, 401);

    const { data: profile, error: profileReadError } = await admin
      .from("profiles").select("role,is_active").eq("id", me.user.id).maybeSingle();
    if (profileReadError) return json({ error: "تعذر التحقق من صلاحيات المستخدم." }, 500);
    if (!profile?.is_active || !["admin", "super_admin"].includes(String(profile.role))) {
      return json({ error: "لا تملك صلاحية إنشاء المستخدمين." }, 403);
    }

    const body = await req.json();
    const phone = normalizePhone(body.phone);
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const username = String(body.username ?? phone.slice(-9)).trim();
    const role = String(body.role ?? "data_entry");

    if (!/^\+967\d{9}$/.test(phone)) return json({ error: "رقم الهاتف اليمني غير صالح." }, 400);
    if (password.length < 8) return json({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف." }, 400);
    if (!fullName) return json({ error: "اسم المستخدم مطلوب." }, 400);

    const { data: exists } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
    if (exists) return json({ error: "رقم الهاتف مستخدم مسبقاً." }, 409);

    const digits = phone.replace(/\D/g, "").replace(/^967/, "");
    const internalEmail = `u${digits}@zakat.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone, username },
      app_metadata: { role },
    });
    if (error || !data.user) return json({ error: "تعذر إنشاء المستخدم. قد يكون الهاتف مستخدماً مسبقاً." }, 400);

    const profilePayload = {
      id: data.user.id,
      full_name: fullName,
      email: internalEmail,
      phone,
      username,
      role,
      role_id: body.role_id || null,
      branch_id: body.branch_id || null,
      is_active: body.is_active !== false,
      job_title: body.job_title || null,
      notes: body.notes || null,
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = await admin.from("profiles").upsert(profilePayload, { onConflict: "id" });
    if (saveError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: "تم التراجع عن الإنشاء لأن حفظ الملف الوظيفي فشل.", details: saveError.message }, 500);
    }

    return json({ success: true, user_id: data.user.id, phone, message: "تم إنشاء المستخدم بنجاح دون SMS أو OTP." }, 201);
  } catch (error) {
    console.error(error);
    return json({ error: "حدث خطأ غير متوقع." }, 500);
  }
});
