export function storageKey(name, settings = globalThis.window?.ZAKAT_CONFIG || {}) {
  const project = settings.demoMode === true ? "demo" : String(settings.supabaseUrl || "demo").trim().replace(/\/+$/, "");
  return "zakat:" + encodeURIComponent(project) + ":" + name;
}
