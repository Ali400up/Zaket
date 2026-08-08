-- =============================================================
-- تهيئة أول مدير واعتماد أول جهاز — نظام الزكاة V11.2
-- =============================================================
-- 1) بعد تشغيل database_complete.sql، أنشئ مستخدم Auth من لوحة Supabase:
--    البريد الداخلي: u779512515@zakat.local
--    كلمة المرور: اختر كلمة قوية (لا تكتبها داخل هذا الملف).
--    فعّل Email confirmed عند الإنشاء.
-- 2) شغّل هذا الملف مرة واحدة من SQL Editor.
-- 3) اترك v_fingerprint فارغاً في التركيب الجديد؛ أول جهاز يسجل بهذا
--    الحساب سيُعتمد تلقائياً مرة واحدة فقط إذا كان سجل الأجهزة فارغاً.
-- 4) لاعتماد بصمة معروفة مباشرة، ضع قيمتها كما تظهر في شاشة الأجهزة
--    بدلاً من NULL ثم أعد تشغيل الملف.

DO $$
DECLARE
  v_phone text := '779512515';
  v_full_name text := 'مدير النظام الأول';
  v_fingerprint text := NULL; -- مثال: 'dev-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  v_user_id uuid;
BEGIN
  v_user_id:=public.bootstrap_first_admin(v_phone,v_full_name,v_fingerprint);
  RAISE NOTICE 'تم تفعيل أول مدير بالمعرف %',v_user_id;
  IF v_fingerprint IS NULL THEN
    RAISE NOTICE 'سيُعتمد أول جهاز لهذا المدير تلقائياً عند أول تسجيل دخول.';
  ELSE
    RAISE NOTICE 'تم اعتماد بصمة الجهاز المحددة.';
  END IF;
END $$;
