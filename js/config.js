/**
 * إعداد الاتصال بقاعدة Supabase.
 * اترك القيم فارغة لتشغيل وضع العرض التجريبي ببيانات محلية.
 * مفتاح anon/publishable مصمم للاستخدام في الواجهة مع تفعيل RLS.
 */
window.ZAKAT_CONFIG = {
  supabaseUrl: "https://zqmdbtgbzkybddhlzdif.supabase.co",
  supabaseAnonKey: "sb_publishable_YcwGuxEwjB_u5StXPWd62w_OiYz_L7k",
  demoMode: false,
  edgeFunctions: {
    createUser: "create-user",
    resetUserPassword: "reset-user-password",
    geminiAssistant: "gemini-assistant"
  },
  appName: "نظام إدارة الزكاة والتبرعات",
  version: "12.0.0",
  releaseName: "النسخة الموحدة الآمنة مع المساعد الذكي",
  currency: "YER",
  locale: "ar-YE",
  pageSize: 10,
  defaultSyncMode: "automatic"
};
