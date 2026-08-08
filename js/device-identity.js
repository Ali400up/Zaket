// يُحفظ اسم المفتاح القديم عمداً حتى لا تتحول أجهزة 11.1 المعتمدة إلى أجهزة
// جديدة بعد التحديث إلى 11.2 وتطلب اعتماداً آخر بلا حاجة.
const DEVICE_FINGERPRINT_KEY = "zakat_device_fingerprint_v11_1";

export function getDeviceFingerprint() {
  let fingerprint = localStorage.getItem(DEVICE_FINGERPRINT_KEY);
  if (!fingerprint) {
    fingerprint = `dev-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, fingerprint);
  }
  return fingerprint;
}

export function getDeviceName() {
  return `${navigator.platform || "Web"} - ${navigator.userAgent.includes("Mobile") ? "هاتف" : "حاسوب"}`;
}
