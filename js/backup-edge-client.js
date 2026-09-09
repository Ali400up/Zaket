function resultError(data, fallback) {
  const message = String(data?.error || fallback || "تعذر تنفيذ عملية النسخ الاحتياطي.");
  return new Error(message + (data?.request_id ? ` (مرجع الطلب: ${data.request_id})` : ""));
}

export function createBackupManagerClient({
  supabase,
  functionName = "backup-manager",
  getFingerprint = () => "",
} = {}) {
  if (!supabase?.functions?.invoke) throw new Error("عميل Supabase غير متاح لعمليات النسخ الاحتياطي.");

  async function call(action, payload) {
    const fingerprint = String(getFingerprint() || "").trim();
    if (!fingerprint) throw new Error("بصمة الجهاز مطلوبة لعمليات النسخ الاحتياطي.");
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { action, payload },
      headers: { "x-device-fingerprint": fingerprint },
    });
    if (error) {
      let details = null;
      try { details = await error.context?.json(); } catch {                                 }
      throw resultError(details, error.message);
    }
    if (data?.error) throw resultError(data);
    return data;
  }

  return {
    listStorageFiles: () => call("list_storage_files", {}),
    startExport: ({ scope = "business", consistent = false } = {}) => call("start_export", { scope, consistent: Boolean(consistent) }),
    exportPart: (sessionId, table, afterId = null, limit = 100) => call("export_part", { session_id: sessionId, table, after_id: afterId, limit }),
    finishExport: sessionId => call("finish_export", { session_id: sessionId }),
    cancelExport: sessionId => call("cancel_export", { session_id: sessionId }),
    startRestore: (manifest, mode = "merge") => call("start_restore", { manifest, mode }),
    stageRestorePart: (sessionId, table, partNo, rowsText, digest) => call("stage_restore_part", { session_id: sessionId, table, part_no: partNo, rows_text: rowsText, checksum: digest }),
    preflightRestore: sessionId => call("preflight_restore", { session_id: sessionId }),
    commitRestore: (sessionId, confirmation) => call("commit_restore", { session_id: sessionId, confirmation }),
  };
}
