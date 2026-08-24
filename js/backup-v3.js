export const BACKUP_V3_FORMAT = "zakat-backup-v3";
export const BACKUP_V3_ALGORITHM = "sha256-postgres-jsonb-v1";
export const BACKUP_V3_PART_LIMIT = 150;
export const BACKUP_V3_PART_BYTES_LIMIT = 450000;

const textEncoder = new TextEncoder();
const TABLE_NAME_PATTERN = /^[a-z_]+$/;
const SAFE_ARCHIVE_PATH = /^(manifest\.json|checksums\.json|integrity-before\.json|README-RESTORE\.txt|tables\/[a-z_]+\/chunk-\d{6}\.json|human-readable\/[a-z_]+\.csv)$/;

function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("لا يدعم هذا المتصفح التحقق المشفر المطلوب للنسخ الاحتياطي.");
  return globalThis.crypto.subtle;
}

function getJsZip() {
  if (!globalThis.JSZip) throw new Error("مكتبة ZIP غير متاحة. تحقق من تحميل التطبيق ثم أعد المحاولة.");
  return globalThis.JSZip;
}

function tableName(value) {
  const table = String(value || "");
  if (!TABLE_NAME_PATTERN.test(table)) throw new Error("اسم جدول النسخة غير صالح.");
  return table;
}

function csvCell(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return '"' + text.replaceAll('"', '""') + '"';
}

function rowsToCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const keys = [...new Set(safeRows.flatMap(row => Object.keys(row || {})))];
  if (!keys.length) return "";
  return "\uFEFF" + [
    keys.map(csvCell).join(","),
    ...safeRows.map(row => keys.map(key => csvCell(row?.[key])).join(","))
  ].join("\n");
}

function chunkPath(table, partNo) {
  return "tables/" + tableName(table) + "/chunk-" + String(partNo).padStart(6, "0") + ".json";
}

function normalizeScope(value) {
  const scope = String(value || "business");
  if (!["business", "administrative"].includes(scope)) throw new Error("نطاق النسخة الاحتياطية غير صالح.");
  return scope;
}

function legacyRowsText(rows) {
  return JSON.stringify(Array.isArray(rows) ? rows : []);
}

export function utf8ByteLength(value) {
  return textEncoder.encode(String(value ?? "")).byteLength;
}

function splitLegacyRows(rows) {
  const chunks = [];
  let current = [];
  for (const row of rows) {
    const candidate = [...current, row];
    const candidateText = legacyRowsText(candidate);
    if (candidate.length > BACKUP_V3_PART_LIMIT || utf8ByteLength(candidateText) > BACKUP_V3_PART_BYTES_LIMIT) {
      if (!current.length) throw new Error("يوجد صف في النسخة القديمة يتجاوز حد الجزء الآمن ولا يمكن تحويله تلقائياً.");
      chunks.push(current);
      current = [row];
      if (utf8ByteLength(legacyRowsText(current)) > BACKUP_V3_PART_BYTES_LIMIT) {
        throw new Error("يوجد صف في النسخة القديمة يتجاوز حد الجزء الآمن ولا يمكن تحويله تلقائياً.");
      }
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function sha256Hex(value) {
  const buffer = await requireCrypto().digest("SHA-256", textEncoder.encode(String(value ?? "")));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validateArchivePath(path) {
  const value = String(path || "");
  if (!SAFE_ARCHIVE_PATH.test(value) || value.includes("..") || value.startsWith("/") || value.includes("\\")) {
    throw new Error("مسار ملف النسخة غير آمن أو غير مدعوم.");
  }
  return true;
}

export function buildRestoreReadme() {
  return [
    "دليل استعادة نسخة نظام الزكاة V3",
    "",
    "1) افتح الإعدادات ← النسخ الاحتياطي والاستعادة من حساب مدير على جهاز معتمد.",
    "2) ارفع ملف ZIP كما هو؛ لا تفك ضغطه ولا تعدل الملفات الداخلية.",
    "3) يقرأ النظام البصمات محلياً ثم يرفع الأجزاء تدريجياً ويمكنه استكمال الجزء الفاشل.",
    "4) راجع المعاينة. وضع الدمج هو الوضع الافتراضي. وضع المطابقة EXACT-RESTORE مخصص للمدير فقط.",
    "5) لا تتضمن هذه الحزمة كلمات مرور Auth أو أسرار Gemini أو ملفات Supabase Storage الثنائية.",
    "6) لاستعادة مشروع Supabase كاملاً، نفذ أيضاً نسخة منصة مستقلة لـ Auth وStorage وإعدادات Edge Functions.",
    "",
    "هذه الملفات human-readable/ للعرض فقط ولا تستخدم كمدخل للاستعادة."
  ].join("\n");
}

export async function createV3Archive(dataService, options = {}) {
  const scope = normalizeScope(options.scope);
  const consistent = Boolean(options.consistent);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const pageSize = Math.max(1, Math.min(BACKUP_V3_PART_LIMIT, Number(options.pageSize) || 100));
  const started = await dataService.startBackupV3({ scope, consistent });
  const sessionId = started?.session_id;
  if (!sessionId) throw new Error("لم ينشئ الخادم جلسة نسخ احتياطي صالحة.");

  try {
  const JSZip = getJsZip();
  const zip = new JSZip();
  const tablePlan = Array.isArray(started.tables) ? started.tables : [];
  const manifest = {
    format: BACKUP_V3_FORMAT,
    version: window.ZAKAT_CONFIG?.version || "12.2.0",
    schema_version: "12.2.0",
    exported_at: new Date().toISOString(),
    exported_by: started.exported_by || null,
    scope,
    data_revision: started.data_revision,
    checksum_algorithm: BACKUP_V3_ALGORITHM,
    part_limit: Number(started.part_limit) || BACKUP_V3_PART_LIMIT,
    part_bytes_limit: Number(started.part_bytes_limit) || BACKUP_V3_PART_BYTES_LIMIT,
    tables: {}
  };
  const checksums = { algorithm: "SHA-256", parts: {}, tables: {}, manifest: null };
  let totalRows = 0;
  let totalParts = 0;

  for (let index = 0; index < tablePlan.length; index += 1) {
    const table = tableName(tablePlan[index]?.table || tablePlan[index]?.table_name);
    let cursor = null;
    let partNo = 1;
    let rowsCount = 0;
    const parts = [];
    const csvRows = [];
    let tableDone = false;

    while (!tableDone) {
      const response = await dataService.readBackupV3Part(sessionId, table, cursor, pageSize);
      const rowsText = String(response?.rows_text ?? "");
      const checksum = String(response?.checksum || "");
      const rowCount = Number(response?.row_count || 0);
      if (!rowsText || !/^[0-9a-f]{64}$/.test(checksum) || rowCount < 0 || rowCount > BACKUP_V3_PART_LIMIT) {
        throw new Error("استجابة جزء النسخ لجدول " + table + " غير صالحة.");
      }
      if (utf8ByteLength(rowsText) > Number(started.part_bytes_limit || BACKUP_V3_PART_BYTES_LIMIT)) {
        throw new Error("استجابة جزء النسخ لجدول " + table + " تجاوزت الحد الآمن.");
      }
      if (await sha256Hex(rowsText) !== checksum) {
        throw new Error("فشل التحقق من بصمة الجزء " + partNo + " لجدول " + table + ".");
      }
      let rows;
      try { rows = JSON.parse(rowsText); } catch { throw new Error("جزء جدول " + table + " لا يحتوي JSON صالحاً."); }
      if (!Array.isArray(rows) || rows.length !== rowCount) {
        throw new Error("عدد صفوف الجزء " + partNo + " لجدول " + table + " غير متطابق.");
      }
      if (rowCount) {
        const path = chunkPath(table, partNo);
        zip.file(path, rowsText);
        parts.push({ part_no: partNo, path, row_count: rowCount, checksum });
        checksums.parts[path] = checksum;
        rowsCount += rowCount;
        totalRows += rowCount;
        totalParts += 1;
        csvRows.push(...rows);
        partNo += 1;
      }
      onProgress({
        phase: "export",
        table,
        tableIndex: index + 1,
        tableCount: tablePlan.length,
        partNo: Math.max(1, partNo - 1),
        rows: totalRows,
        message: "جاري قراءة " + table + " (" + rowsCount + " صف)"
      });
      const nextCursor = response?.next_cursor || null;
      tableDone = Boolean(response?.done);
      if (!tableDone && (!nextCursor || nextCursor === cursor)) {
        throw new Error("لم يعط الخادم مؤشراً آمناً للجزء التالي من جدول " + table + ".");
      }
      cursor = nextCursor;
    }

    const descriptor = JSON.stringify(parts.map(part => [part.part_no, part.row_count, part.checksum]));
    checksums.tables[table] = await sha256Hex(descriptor);
    manifest.tables[table] = { rank: Number(tablePlan[index]?.rank || index + 1), row_count: rowsCount, parts, checksum: checksums.tables[table] };
    zip.file("human-readable/" + table + ".csv", rowsToCsv(csvRows));
  }

  const finished = await dataService.finishBackupV3(sessionId);
  if (!finished?.ready || Number(finished?.data_revision) !== Number(started.data_revision)) {
    throw new Error("رفض الخادم اعتماد النسخة لأن البيانات تغيرت أثناء القراءة.");
  }
  const manifestText = JSON.stringify(manifest, null, 2);
  checksums.manifest = await sha256Hex(manifestText);
  zip.file("manifest.json", manifestText);
  zip.file("checksums.json", JSON.stringify(checksums, null, 2));
  zip.file("integrity-before.json", JSON.stringify(started.integrity_before || [], null, 2));
  zip.file("README-RESTORE.txt", buildRestoreReadme());
  onProgress({ phase: "compress", rows: totalRows, parts: totalParts, message: "جاري إنشاء ملف ZIP والتحقق النهائي..." });
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  onProgress({ phase: "complete", rows: totalRows, parts: totalParts, message: "اكتملت النسخة الاحتياطية V3." });
  return {
    blob,
    manifest,
    checksums,
    sessionId,
    totalRows,
    totalParts,
    fileName: "zakat-backup-v3-" + scope + "-" + new Date().toISOString().slice(0, 10) + ".zip"
  };
  } catch (error) {
    try { await dataService.cancelBackupV3?.(sessionId); } catch { /* lock expires server-side if cancellation cannot reach it */ }
    throw error;
  }
}

export async function inspectV3Archive(file) {
  const JSZip = getJsZip();
  const zip = await JSZip.loadAsync(file);
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) validateArchivePath(entry.name);
  }
  const manifestEntry = zip.file("manifest.json");
  const checksumsEntry = zip.file("checksums.json");
  const integrityEntry = zip.file("integrity-before.json");
  if (!manifestEntry || !checksumsEntry || !integrityEntry) {
    throw new Error("الملف لا يحتوي ملفات V3 الأساسية المطلوبة.");
  }
  let manifest;
  let checksums;
  let integrityBefore;
  try {
    manifest = JSON.parse(await manifestEntry.async("text"));
    checksums = JSON.parse(await checksumsEntry.async("text"));
    integrityBefore = JSON.parse(await integrityEntry.async("text"));
  } catch {
    throw new Error("بيانات تعريف النسخة لا يمكن قراءتها.");
  }
  if (manifest?.format !== BACKUP_V3_FORMAT || !manifest?.tables || typeof manifest.tables !== "object") {
    throw new Error("صيغة manifest ليست نسخة زكاة V3 صالحة.");
  }
  normalizeScope(manifest.scope);
  if (manifest.checksum_algorithm !== BACKUP_V3_ALGORITHM) {
    throw new Error("خوارزمية تحقق النسخة غير مدعومة.");
  }
  const manifestText = await manifestEntry.async("text");
  if (!/^[0-9a-f]{64}$/.test(String(checksums?.manifest || "")) || await sha256Hex(manifestText) !== checksums.manifest) {
    throw new Error("بصمة manifest لا تطابق الملف.");
  }

  const parts = [];
  const usedPaths = new Set();
  let totalRows = 0;
  for (const [rawTable, definition] of Object.entries(manifest.tables)) {
    const table = tableName(rawTable);
    if (!definition || typeof definition !== "object" || !Array.isArray(definition.parts)) {
      throw new Error("تعريف جدول " + table + " غير صالح.");
    }
    let tableRows = 0;
    const usedPartNumbers = new Set();
    for (const descriptor of definition.parts) {
      const partNo = Number(descriptor?.part_no);
      const path = String(descriptor?.path || chunkPath(table, partNo));
      if (!Number.isInteger(partNo) || partNo <= 0 || usedPartNumbers.has(partNo) || usedPaths.has(path)) {
        throw new Error("هناك تكرار أو رقم غير صالح لجزء جدول " + table + ".");
      }
      validateArchivePath(path);
      if (path !== chunkPath(table, partNo)) throw new Error("مسار جزء جدول " + table + " لا يطابق رقمه.");
      const entry = zip.file(path);
      if (!entry) throw new Error("الجزء " + partNo + " من جدول " + table + " مفقود.");
      const rowsText = await entry.async("text");
      const checksum = String(descriptor?.checksum || "");
      if (utf8ByteLength(rowsText) > Number(manifest.part_bytes_limit || BACKUP_V3_PART_BYTES_LIMIT)) {
        throw new Error("حجم الجزء " + partNo + " من جدول " + table + " يتجاوز الحد الآمن.");
      }
      if (!/^[0-9a-f]{64}$/.test(checksum) || await sha256Hex(rowsText) !== checksum || checksums?.parts?.[path] !== checksum) {
        throw new Error("بصمة الجزء " + partNo + " من جدول " + table + " غير مطابقة.");
      }
      let rows;
      try { rows = JSON.parse(rowsText); } catch { throw new Error("جزء جدول " + table + " لا يحتوي JSON صالحاً."); }
      if (!Array.isArray(rows) || rows.length !== Number(descriptor?.row_count) || rows.length > BACKUP_V3_PART_LIMIT) {
        throw new Error("عدد صفوف الجزء " + partNo + " من جدول " + table + " غير صالح.");
      }
      usedPartNumbers.add(partNo);
      usedPaths.add(path);
      tableRows += rows.length;
      totalRows += rows.length;
      parts.push({ table, partNo, path, rowsText, rowCount: rows.length, checksum });
    }
    if (tableRows !== Number(definition.row_count || 0)) {
      throw new Error("إجمالي صفوف جدول " + table + " لا يطابق manifest.");
    }
    const descriptorText = JSON.stringify(definition.parts.map(part => [part.part_no, part.row_count, part.checksum]));
    if (checksums?.tables?.[table] !== await sha256Hex(descriptorText)) {
      throw new Error("بصمة جدول " + table + " غير مطابقة.");
    }
  }
  return { zip, manifest, checksums, integrityBefore, parts, totalRows, legacy: false };
}

export async function normalizeLegacyBackup(backup) {
  if (!backup || !["zakat-backup-v1", "zakat-backup-v2"].includes(backup.format) || !backup.tables || typeof backup.tables !== "object") {
    throw new Error("صيغة النسخة القديمة غير مدعومة.");
  }
  if (backup.format === "zakat-backup-v2" && !/^[0-9a-f]{64}$/.test(String(backup.checksum || ""))) {
    throw new Error("نسخة V2 لا تحتوي بصمة SHA-256 صالحة للتحقق على الخادم.");
  }
  const tables = {};
  const parts = [];
  const checksums = { algorithm: "SHA-256", parts: {}, tables: {}, manifest: null };
  let totalRows = 0;
  for (const [rawTable, candidateRows] of Object.entries(backup.tables)) {
    const table = tableName(rawTable);
    const rows = Array.isArray(candidateRows) ? candidateRows : [];
    const tableParts = [];
    const rowChunks = splitLegacyRows(rows);
    for (let index = 0; index < rowChunks.length; index += 1) {
      const partNo = index + 1;
      const partRows = rowChunks[index];
      const rowsText = legacyRowsText(partRows);
      const checksum = await sha256Hex(rowsText);
      const path = chunkPath(table, partNo);
      tableParts.push({ part_no: partNo, path, row_count: partRows.length, checksum });
      checksums.parts[path] = checksum;
      parts.push({ table, partNo, path, rowsText, rowCount: partRows.length, checksum });
      totalRows += partRows.length;
    }
    checksums.tables[table] = await sha256Hex(JSON.stringify(tableParts.map(part => [part.part_no, part.row_count, part.checksum])));
    tables[table] = { row_count: rows.length, parts: tableParts, checksum: checksums.tables[table] };
  }
  const manifest = {
    format: BACKUP_V3_FORMAT,
    version: "legacy-converted",
    schema_version: "12.2.0",
    exported_at: backup.exported_at || null,
    scope: "business",
    data_revision: null,
    checksum_algorithm: BACKUP_V3_ALGORITHM,
    part_limit: BACKUP_V3_PART_LIMIT,
    part_bytes_limit: BACKUP_V3_PART_BYTES_LIMIT,
    legacy_source_format: backup.format,
    legacy_source_checksum: backup.format === "zakat-backup-v2" ? backup.checksum : null,
    tables
  };
  checksums.manifest = await sha256Hex(JSON.stringify(manifest, null, 2));
  return { manifest, checksums, integrityBefore: backup.integrity_before || [], parts, totalRows, legacy: true };
}

export function downloadV3Archive(result) {
  if (!result?.blob || !result?.fileName) throw new Error("لا يوجد ملف نسخة جاهز للتنزيل.");
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
