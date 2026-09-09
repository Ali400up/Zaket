
export function healthMetric(health, key) {
  const value = health?.[key];
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function describeHealthError(error = {}) {
  const code = String(error.code || "");
  const detail = typeof error === "string" ? error : String(error.message || "تعذر إكمال الفحص");
  let action = "أعد المحاولة، وإن استمر الخطأ أرسل التفاصيل لمسؤول النظام.";
  if (/^(42703|42P01|42883|PGRST20[245])$/.test(code) || /does not exist|schema cache/i.test(detail)) {
    action = "مخطط قاعدة البيانات لا يطابق التطبيق. تحقق من اختيار المشروع الصحيح واكتمال تثبيت database_complete.sql على قاعدة جديدة؛ لا تعِد تشغيل المثبت فوق بيانات موجودة.";
  } else if (code === "42501" || /permission|jwt|الجهاز|الجلسة|غير مصرح|مدير النظام|معتمد/i.test(detail)) {
    action = "سجل الدخول بحساب مدير نشط وتأكد من اعتماد هذا الجهاز.";
  } else if (/timeout|abort|network|fetch|انقطع|انتهت مهلة/i.test(detail)) {
    action = "تحقق من الاتصال ثم أعد المحاولة؛ تبقى المعلومات المحلية متاحة.";
  }
  return { detail, action, code };
}

export async function requestSystemHealth({ client, online, localMetrics = {}, timeoutMs = 7000 }) {
  if (!client || !online) return { ...localMetrics, live_unavailable: true, offline: true };
  const controller = new AbortController();
  let timer;
  try {
    const response = client.rpc("get_system_health");
    const query = typeof response.abortSignal === "function" ? response.abortSignal(controller.signal) : response;
    const { data, error } = await Promise.race([
      query,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("انتهت مهلة جلب حالة النظام"));
        }, timeoutMs);
      }),
    ]);
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("استجابة حالة النظام فارغة أو غير صالحة");
    return { ...data, ...localMetrics };
  } catch (error) {
    return { ...localMetrics, live_unavailable: true, diagnostic_error: String(error.message || error), diagnostic_code: error.code || "" };
  } finally {
    clearTimeout(timer);
  }
}
