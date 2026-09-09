export const DEFAULT_ATTACHMENT_POLICY = Object.freeze({
  profileTargetBytes: 120 * 1024,
  documentTargetBytes: 350 * 1024,
  maxOriginalBytes: 8 * 1024 * 1024,
  profileMaxDimension: 900,
  documentMaxDimension: 1800,
});

const EXTENSIONS = Object.freeze({
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
});

function finiteNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeAttachmentPolicy(settings = {}, kind = "document") {
  const profile = kind === "profile";
  const fallbackKb = (profile ? DEFAULT_ATTACHMENT_POLICY.profileTargetBytes : DEFAULT_ATTACHMENT_POLICY.documentTargetBytes) / 1024;
  const targetKb = finiteNumber(
    profile ? settings.profile_image_max_kb : settings.document_image_max_kb,
    fallbackKb,
    40,
    2048,
  );
  const maxOriginalMb = finiteNumber(settings.attachment_original_max_mb, DEFAULT_ATTACHMENT_POLICY.maxOriginalBytes / 1024 / 1024, 1, 50);
  return {
    kind: profile ? "profile" : "document",
    targetBytes: Math.round(targetKb * 1024),
    maxOriginalBytes: Math.round(maxOriginalMb * 1024 * 1024),
    maxDimension: profile ? DEFAULT_ATTACHMENT_POLICY.profileMaxDimension : DEFAULT_ATTACHMENT_POLICY.documentMaxDimension,
    minDimension: profile ? 320 : 640,
  };
}

function extensionFromName(name = "") {
  return String(name).split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "bin";
}

function extensionFor(mimeType, originalName = "") {
  return EXTENSIONS[String(mimeType || "").toLowerCase()] || extensionFromName(originalName);
}

export function buildUniqueStorageName({ uuid, digest, mimeType, originalName = "" }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(uuid || ""))) throw new Error("تعذر إنشاء معرف فريد للمرفق.");
  if (!/^[a-f0-9]{64}$/i.test(String(digest || ""))) throw new Error("بصمة المرفق SHA-256 غير صالحة.");
  return `${String(uuid).toLowerCase()}-${String(digest).toLowerCase()}.${extensionFor(mimeType, originalName)}`;
}

export function createStoragePath(userId, folder, storageName) {
  const safeUser = String(userId || "").replace(/[^a-zA-Z0-9-]/g, "");
  const safeFolder = String(folder || "general").split("/").map(part => part.replace(/[^\p{L}\p{N}_-]/gu, "_")).filter(Boolean).join("/") || "general";
  if (!safeUser || !storageName) throw new Error("مسار المرفق غير صالح.");
  return `${safeUser}/${safeFolder}/${storageName}`;
}

function emit(onProgress, phase, percent, message, extra = {}) {
  onProgress?.({ phase, percent: Math.round(percent), message, ...extra });
}

export async function sha256Blob(blob) {
  const bytes = await blob.arrayBuffer();
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") throw new Error("قارئ الصور غير متاح.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") throw new Error("لوحة ضغط الصور غير متاحة.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToWebP(canvas, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: "image/webp", quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("فشل ترميز WebP.")), "image/webp", quality));
}

export async function compressImageToWebP(file, policy, onProgress = () => {}) {
  const image = await decodeImage(file);
  const originalWidth = Number(image.width || image.naturalWidth || 0);
  const originalHeight = Number(image.height || image.naturalHeight || 0);
  if (!originalWidth || !originalHeight) throw new Error("تعذر قراءة أبعاد الصورة.");

  let scale = Math.min(1, policy.maxDimension / Math.max(originalWidth, originalHeight));
  let best = null;
  for (let pass = 0; pass < 7; pass += 1) {
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = makeCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("تعذر بدء ضاغط الصور.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const blob = await canvasToWebP(canvas, quality);
      if (!best || blob.size < best.size) best = blob;
      const percent = 18 + pass * 8 + (0.82 - quality) * 12;
      onProgress(Math.min(78, percent), `ضغط WebP — ${width}×${height}`);
      if (blob.size <= policy.targetBytes) {
        image.close?.();
        return blob;
      }
    }
    const longest = Math.max(width, height);
    if (longest <= policy.minDimension) break;
    const ratio = Math.max(0.58, Math.min(0.86, Math.sqrt(policy.targetBytes / Math.max(1, best.size)) * 0.94));
    scale *= ratio;
  }
  image.close?.();
  if (!best) throw new Error("لم ينتج ضاغط الصور ملفًا صالحًا.");
  return best;
}

export async function prepareAttachment(file, policy, onProgress = () => {}, adapters = {}) {
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isFinite(Number(file.size))) throw new Error("اختر ملفًا صالحًا.");
  const effectivePolicy = { ...normalizeAttachmentPolicy({}, policy?.kind), ...(policy || {}) };
  if (file.size > effectivePolicy.maxOriginalBytes) {
    throw new Error(`حجم الملف يتجاوز الحد الأصلي المسموح (${Math.round(effectivePolicy.maxOriginalBytes / 1024 / 1024)} ميجابايت).`);
  }

  emit(onProgress, "inspect", 5, "فحص الملف ونوعه");
  let blob = file;
  let compressed = false;
  const mime = String(file.type || "application/octet-stream").toLowerCase();
  const isImage = mime.startsWith("image/");
  const preserveOriginal = ["image/gif", "image/svg+xml"].includes(mime);
  if (isImage && !preserveOriginal) {
    try {
      const compressor = adapters.compressImage || compressImageToWebP;
      const candidate = await compressor(file, effectivePolicy, (percent, message) => emit(onProgress, "compress", percent, message));
      if (candidate?.size && (candidate.size < file.size || file.size > effectivePolicy.targetBytes)) {
        blob = candidate;
        compressed = true;
      }
    } catch (error) {
      emit(onProgress, "compress", 76, "الصيغة لا تقبل الضغط في هذا الجهاز؛ ستحفظ كما هي", { warning: error.message });
    }
  } else {
    emit(onProgress, "compress", 76, isImage ? "حُفظت الصيغة كما هي للمحافظة على محتواها" : "الملف لا يحتاج ضغط صور");
  }

  emit(onProgress, "hash", 86, "حساب بصمة SHA-256");
  const digest = await sha256Blob(blob);
  const uuid = (adapters.uuid || (() => globalThis.crypto.randomUUID()))();
  const mimeType = blob.type || mime || "application/octet-stream";
  const storageName = buildUniqueStorageName({ uuid, digest, mimeType, originalName: file.name });
  const previewUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : null;
  const result = {
    blob,
    digest,
    storageName,
    mimeType,
    originalName: file.name || storageName,
    originalSize: file.size,
    storedSize: blob.size,
    previewUrl,
    compressed,
  };
  emit(onProgress, "ready", 100, compressed ? "اكتمل الضغط وأصبحت الصورة جاهزة" : "الملف جاهز للرفع", { originalSize: file.size, storedSize: blob.size });
  return result;
}
