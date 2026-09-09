const PREFIX = "zakat:session-resumed:";

function safeSessionId(sessionId) {
  return typeof sessionId === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(sessionId) ? sessionId : "";
}

export function sessionResumeKey(sessionId) {
  const safe = safeSessionId(sessionId);
  return safe ? `${PREFIX}${safe}` : "";
}

export function shouldRecordSessionResume(storage, sessionId) {
  const key = sessionResumeKey(sessionId);
  if (!key || !storage?.getItem) return false;
  try { return storage.getItem(key) !== "1"; }
  catch { return false; }
}

export function markSessionResume(storage, sessionId) {
  const key = sessionResumeKey(sessionId);
  if (!key || !storage?.setItem) return false;
  try { storage.setItem(key, "1"); return true; }
  catch { return false; }
}

