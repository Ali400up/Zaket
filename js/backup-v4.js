import { createV3Archive, inspectV3Archive, sha256Hex } from "./backup-v3.js";
import { sha256Blob } from "./attachment-manager.js";

export const BACKUP_V4_FORMAT = "zakat-backup-v4";
const STORAGE_BUCKET = "zakat-attachments";
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

function getJsZip() {
  if (!globalThis.JSZip) throw new Error("مكتبة ZIP غير متاحة. تحقق من تحميل التطبيق ثم أعد المحاولة.");
  return globalThis.JSZip;
}

export function storageArchivePath(index) {
  const number = Number(index);
  if (!Number.isInteger(number) || number < 1 || number > 999999) throw new Error("رقم ملف المرفق غير صالح.");
  return `storage/files/file-${String(number).padStart(6, "0")}.bin`;
}

export function validateStorageObjectPath(path) {
  const value = String(path || "");
  if (!value || value.length > 1000 || value.startsWith("/") || value.endsWith("/") || value.includes("..") || value.includes("\\") || /[\0-\x1f]/.test(value)) {
    throw new Error("مسار مرفق النسخة غير آمن.");
  }
  return value;
}

export function normalizeStorageInventory(rows) {
  if (!Array.isArray(rows)) throw new Error("لم يُرجع الخادم جرد المرفقات بصيغة صالحة.");
  const seen = new Set();
  return rows.map(row => {
    const path = validateStorageObjectPath(row?.path || row?.name);
    if (seen.has(path)) throw new Error(`تكرر مسار المرفق في الجرد: ${path}`);
    seen.add(path);
    const size = Number(row?.size ?? row?.metadata?.size ?? 0);
    if (!Number.isInteger(size) || size < 0) throw new Error(`حجم المرفق غير صالح: ${path}`);
    return {
      path,
      size,
      mimeType: String(row?.mime_type || row?.mimetype || row?.metadata?.mimetype || "application/octet-stream"),
      updatedAt: row?.updated_at || row?.updatedAt || null,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

async function inventoryChecksum(inventory) {
  return sha256Hex(JSON.stringify(inventory.map(item => [item.path, item.size, item.updatedAt])));
}

export function buildTableRestoreManifest(manifest) {
  const { files: _files, storage: _storage, format: _format, ...tableManifest } = manifest || {};
  return { format: "zakat-backup-v3", ...tableManifest };
}

function restoreReadme() {
  return [
    "استعادة نسخة نظام الزكاة V4",
    "",
    "تحتوي هذه الحزمة بيانات التطبيق وجميع مرفقات مخزن zakat-attachments مع بصمة SHA-256 مستقلة لكل ملف.",
    "ارفع ملف ZIP من شاشة النسخ الاحتياطي. يفحص النظام كل جزء وكل مرفق قبل إرسال أي شيء للخادم.",
    "الدمج لا يحذف الموجود. المطابقة تنظف الملفات الزائدة بعد نجاح استعادة البيانات فقط.",
    "لا تتضمن الحزمة كلمات مرور Supabase Auth أو أسرار Edge Functions/Gemini."
  ].join("\n");
}

export async function createV4Archive(dataService, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const v3 = await createV3Archive(dataService, options);
  try {
    const JSZip = getJsZip();
    const zip = await JSZip.loadAsync(v3.blob);
    const before = normalizeStorageInventory(await dataService.listStorageFiles());
    const beforeChecksum = await inventoryChecksum(before);
    const files = [];
    const fileChecksums = {};
    let totalBytes = 0;

    for (let index = 0; index < before.length; index += 1) {
      const item = before[index];
      onProgress({ phase: "storage", fileIndex: index + 1, fileCount: before.length, message: `تنزيل المرفق ${index + 1} من ${before.length}` });
      const blob = await dataService.downloadStorageFile(item.path);
      if (!(blob instanceof Blob) || blob.size !== item.size) throw new Error(`تعذر نسخ المرفق كاملاً: ${item.path}`);
      const digest = await sha256Blob(blob);
      const archivePath = storageArchivePath(index + 1);
      zip.file(archivePath, blob);
      files.push({ storage_path: item.path, archive_path: archivePath, size: blob.size, mime_type: item.mimeType, updated_at: item.updatedAt, sha256: digest });
      fileChecksums[archivePath] = digest;
      totalBytes += blob.size;
    }

    const after = normalizeStorageInventory(await dataService.listStorageFiles());
    const afterChecksum = await inventoryChecksum(after);
    if (beforeChecksum !== afterChecksum) throw new Error("تغيرت المرفقات أثناء النسخ؛ أعد المحاولة للحصول على نسخة كاملة ومتسقة.");

    const manifest = {
      ...v3.manifest,
      format: BACKUP_V4_FORMAT,
      version: globalThis.window?.ZAKAT_CONFIG?.version || "12.5.0",
      schema_version: "12.5.0",
      storage: { bucket: STORAGE_BUCKET, file_count: files.length, total_bytes: totalBytes, inventory_sha256: beforeChecksum },
      files,
    };
    const checksums = { ...v3.checksums, files: fileChecksums, manifest: null };
    const manifestText = JSON.stringify(manifest, null, 2);
    checksums.manifest = await sha256Hex(manifestText);
    zip.file("manifest.json", manifestText);
    zip.file("checksums.json", JSON.stringify(checksums, null, 2));
    zip.file("README-RESTORE.txt", restoreReadme());
    onProgress({ phase: "compress", rows: v3.totalRows, parts: v3.totalParts, message: "ضغط البيانات وجميع المرفقات في ZIP..." });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    onProgress({ phase: "complete", message: "اكتملت نسخة V4 وتحققت جميع بصماتها." });
    return {
      ...v3,
      blob,
      manifest,
      checksums,
      totalFiles: files.length,
      storageBytes: totalBytes,
      fileName: `zakat-backup-v4-${manifest.scope}-${new Date().toISOString().slice(0, 10)}.zip`,
    };
  } catch (error) {
    throw new Error(`لم تُنشأ نسخة ناقصة ولم يبدأ تنزيلها. السبب: ${error.message || error}`);
  }
}

export async function inspectV4Archive(file) {
  const inspection = await inspectV3Archive(file, { acceptedFormats: [BACKUP_V4_FORMAT] });
  const { zip, manifest, checksums } = inspection;
  if (!Array.isArray(manifest.files) || manifest.storage?.bucket !== STORAGE_BUCKET) throw new Error("تعريف مرفقات V4 غير صالح.");
  const paths = new Set();
  const storagePaths = new Set();
  let totalBytes = 0;
  for (let index = 0; index < manifest.files.length; index += 1) {
    const descriptor = manifest.files[index];
    const archivePath = String(descriptor?.archive_path || "");
    const storagePath = validateStorageObjectPath(descriptor?.storage_path);
    const digest = String(descriptor?.sha256 || "");
    if (archivePath !== storageArchivePath(index + 1) || paths.has(archivePath) || storagePaths.has(storagePath) || !CHECKSUM_PATTERN.test(digest)) {
      throw new Error("تعريف أحد مرفقات V4 مكرر أو غير صالح.");
    }
    const entry = zip.file(archivePath);
    if (!entry) throw new Error(`المرفق مفقود من الحزمة: ${storagePath}`);
    const blob = await entry.async("blob");
    if (blob.size !== Number(descriptor.size) || await sha256Blob(blob) !== digest || checksums?.files?.[archivePath] !== digest) {
      throw new Error(`بصمة أو حجم المرفق غير مطابق: ${storagePath}`);
    }
    paths.add(archivePath);
    storagePaths.add(storagePath);
    totalBytes += blob.size;
  }
  const archivedStoragePaths = Object.values(zip.files).filter(entry => !entry.dir && entry.name.startsWith("storage/files/")).map(entry => entry.name);
  if (archivedStoragePaths.some(path => !paths.has(path)) || Number(manifest.storage.file_count) !== paths.size || Number(manifest.storage.total_bytes) !== totalBytes) {
    throw new Error("حزمة V4 تحتوي مرفقات زائدة أو ناقصة.");
  }
  const inventory = normalizeStorageInventory(manifest.files.map(item => ({ name: item.storage_path, size: item.size, mimetype: item.mime_type, updated_at: item.updated_at })));
  if (!CHECKSUM_PATTERN.test(String(manifest.storage.inventory_sha256 || "")) || await inventoryChecksum(inventory) !== manifest.storage.inventory_sha256) {
    throw new Error("بصمة جرد مرفقات V4 غير مطابقة.");
  }
  return { ...inspection, tableManifest: buildTableRestoreManifest(manifest), totalFiles: paths.size, storageBytes: totalBytes };
}

function resumeStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function resumeKey(inspection) {
  return `zakat_restore_v4_${inspection.checksums.manifest}`;
}

export async function restoreV4Files(dataService, inspection, options = {}) {
  if (inspection?.manifest?.format !== BACKUP_V4_FORMAT) return { restored: 0, skipped: 0 };
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const storage = resumeStorage();
  const key = resumeKey(inspection);
  let completed = new Set();
  try { completed = new Set(JSON.parse(storage?.getItem(key) || "[]")); } catch { completed = new Set(); }
  const current = new Map(normalizeStorageInventory(await dataService.listStorageFiles()).map(item => [item.path, item]));
  let restored = 0;
  let skipped = 0;
  for (let index = 0; index < inspection.manifest.files.length; index += 1) {
    const descriptor = inspection.manifest.files[index];
    const existing = current.get(descriptor.storage_path);
    onProgress({ phase: "restore-storage", fileIndex: index + 1, fileCount: inspection.totalFiles, message: `استعادة المرفق ${index + 1} من ${inspection.totalFiles}` });
    const archiveBlob = await inspection.zip.file(descriptor.archive_path).async("blob");
    if (existing) {
      const existingBlob = await dataService.downloadStorageFile(descriptor.storage_path);
      if (existingBlob.size !== archiveBlob.size || await sha256Blob(existingBlob) !== descriptor.sha256) {
        throw new Error(`يوجد ملف مختلف في المسار نفسه ولن يتم استبداله: ${descriptor.storage_path}`);
      }
      skipped += 1;
    } else {
      await dataService.uploadStorageFile(descriptor.storage_path, archiveBlob, descriptor.mime_type);
      const verified = await dataService.downloadStorageFile(descriptor.storage_path);
      if (verified.size !== archiveBlob.size || await sha256Blob(verified) !== descriptor.sha256) {
        throw new Error(`فشل التحقق بعد رفع المرفق: ${descriptor.storage_path}`);
      }
      restored += 1;
      current.set(descriptor.storage_path, { path: descriptor.storage_path, size: archiveBlob.size });
    }
    completed.add(descriptor.storage_path);
    storage?.setItem(key, JSON.stringify([...completed]));
  }
  return { restored, skipped };
}

export async function cleanupExactV4Files(dataService, inspection, onProgress = () => {}) {
  if (inspection?.manifest?.format !== BACKUP_V4_FORMAT) return { removed: 0 };
  const expected = new Set(inspection.manifest.files.map(item => item.storage_path));
  const current = normalizeStorageInventory(await dataService.listStorageFiles());
  const extra = current.map(item => item.path).filter(path => !expected.has(path));
  for (let index = 0; index < extra.length; index += 100) {
    const batch = extra.slice(index, index + 100);
    onProgress({ phase: "cleanup-storage", message: `تنظيف ${Math.min(index + batch.length, extra.length)} من ${extra.length} ملف زائد` });
    await dataService.deleteStorageFiles(batch);
  }
  resumeStorage()?.removeItem(resumeKey(inspection));
  return { removed: extra.length };
}

export function clearV4Resume(inspection) {
  if (inspection?.checksums?.manifest) resumeStorage()?.removeItem(resumeKey(inspection));
}

export function downloadV4Archive(result) {
  if (!result?.blob || !result?.fileName) throw new Error("لا يوجد ملف نسخة V4 جاهز للتنزيل.");
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
