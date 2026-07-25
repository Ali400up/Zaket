/**
 * إعداد الاتصال بقاعدة Supabase.
 * اترك القيم فارغة لتشغيل وضع العرض التجريبي ببيانات محلية.
 * مفتاح anon/publishable مصمم للاستخدام في الواجهة مع تفعيل RLS.
 */
window.ZAKAT_CONFIG = {
  supabaseUrl: "https://fovcxrlncrxgdjmdjxaw.supabase.co",
  supabaseAnonKey: "sb_publishable_CeDvJu27lcSl6ebN3mTZ_w_A191I-VF",
  demoMode: false,
  edgeFunctions: {
    createUser: "create-user",
    resetUserPassword: "reset-user-password"
  },
  appName: "نظام إدارة الزكاة والتبرعات",
  currency: "YER",
  locale: "ar-YE",
  pageSize: 10,
  defaultSyncMode: "automatic"
};
