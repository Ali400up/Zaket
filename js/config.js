/**
 * إعداد الاتصال بقاعدة Supabase.
 * اترك القيم فارغة لتشغيل وضع العرض التجريبي ببيانات محلية.
 * مفتاح anon/publishable مصمم للاستخدام في الواجهة مع تفعيل RLS.
 */
window.ZAKAT_CONFIG = {
  supabaseUrl: "https://ljvfkcgrytkjpdtbexlu.supabase.co",
  supabaseAnonKey: "sb_publishable_bRw7Hn7EBpR99gqdZnCGtQ_MaBZjYED",
  demoMode: false,
  edgeFunctions: {
    createUser: "create-user",
    resetUserPassword: "reset-user-password",
    geminiAssistant: "gemini-assistant",
    backupManager: "backup-manager"
  },
  appName: "نظام إدارة الزكاة والتبرعات",
  version: "12.2.0",
  releaseName: "نسخ Edge موثوق ودليل تنفيذي",
  currency: "YER",
  locale: "ar-YE",
  pageSize: 10,
  defaultSyncMode: "automatic"
};

