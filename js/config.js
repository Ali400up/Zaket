/**
 * إعداد الاتصال بقاعدة Supabase.
 * اترك القيم فارغة لتشغيل وضع العرض التجريبي ببيانات محلية.
 * مفتاح anon/publishable مصمم للاستخدام في الواجهة مع تفعيل RLS.
 */
window.ZAKAT_CONFIG = {
  supabaseUrl: "https://miivxpuymxzcchfdgobk.supabase.co",
  supabaseAnonKey: "sb_publishable_uaty7Ue4iPJbK95q_6WBQg_hTQkEkfu",
  demoMode: false,
  edgeFunctions: {
    createUser: "create-user",
    resetUserPassword: "reset-user-password"
  },
  appName: "نظام إدارة الزكاة والتبرعات",
  currency: "YER",
  locale: "ar-YE",
  pageSize: 10
};
