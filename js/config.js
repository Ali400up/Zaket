/**
 * إعداد الاتصال بقاعدة Supabase عبر Vercel Proxy.
 *
 * المتصفح سيتصل بنفس نطاق التطبيق:
 * /api/supabase
 *
 * ثم Vercel يمرر الطلب إلى مشروع Supabase الحقيقي.
 *
 * مفتاح publishable مصمم للاستخدام في الواجهة
 * بشرط تفعيل RLS بصورة صحيحة.
 */

const SUPABASE_PROXY_URL =
  `${window.location.origin}/api/supabase`;

window.ZAKAT_CONFIG = Object.freeze({
  supabaseUrl:
    SUPABASE_PROXY_URL,

  supabaseAnonKey:
    "sb_publishable_uaty7Ue4iPJbK95q_6WBQg_hTQkEkfu",

  demoMode:
    false,

  edgeFunctions: Object.freeze({
    createUser:
      "create-user",

    resetUserPassword:
      "reset-user-password"
  }),

  appName:
    "نظام إدارة الزكاة والتبرعات",

  currency:
    "YER",

  locale:
    "ar-YE",

  pageSize:
    10
});
