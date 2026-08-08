/**
 * إعداد الاتصال بقاعدة Supabase.
 * اترك القيم فارغة لتشغيل وضع العرض التجريبي ببيانات محلية.
 * مفتاح anon/publishable مصمم للاستخدام في الواجهة مع تفعيل RLS.
 */
window.ZAKAT_CONFIG = {
  supabaseUrl: "https://pgnpuspqnkmmnjpvejnq.supabase.co",
  supabaseAnonKey: "sb_publishable_XLCnJyBDtJ_UQRjSQQO_5A_akuKCEy1",
  demoMode: false,
  edgeFunctions: {
    createUser: "create-user",
    resetUserPassword: "reset-user-password"
  },
  appName: "نظام إدارة الزكاة والتبرعات",
  version: "11.2.2",
  releaseName: "النسخة الموحدة المراجعة",
  currency: "YER",
  locale: "ar-YE",
  pageSize: 10,
  defaultSyncMode: "automatic"
};
