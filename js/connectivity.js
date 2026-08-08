const config = window.ZAKAT_CONFIG || {};

let state = {
  online: false,
  verified: false,
  checking: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastError: null
};

let activeCheck = null;
const listeners = new Set();
let monitoringStopped = false;
let periodicCheckTimer = null;

function notify() {
  if (monitoringStopped) return;
  const detail = { ...state };
  listeners.forEach(listener => {
    try { listener(detail); }
    catch (error) { console.warn("connectivity listener failed", error); }
  });
  window.dispatchEvent(new CustomEvent("zakat:connection-change", { detail }));
}

function probeTargets() {
  const base = String(config.supabaseUrl || "").trim().replace(/\/$/, "");
  if (base) {
    return [{
      url: `${base}/auth/v1/health`,
      mode: "cors",
      requireOk: true,
      headers: config.supabaseAnonKey ? {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`
      } : {}
    }];
  }

  // وضع Demo: لا نعتمد على navigator.onLine لأنه غير دقيق في بعض WebView.
  return [
    { url: "https://connectivitycheck.gstatic.com/generate_204", mode: "no-cors", requireOk: false, headers: {} },
    { url: "https://clients3.google.com/generate_204", mode: "no-cors", requireOk: false, headers: {} }
  ];
}

async function probe(target, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const separator = target.url.includes("?") ? "&" : "?";
    const response = await fetch(`${target.url}${separator}zakat_ping=${Date.now()}_${Math.random()}`, {
      method: "GET",
      headers: target.headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      mode: target.mode,
      signal: controller.signal
    });
    if (target.requireOk && !response.ok) {
      throw new Error(`Connectivity endpoint returned HTTP ${response.status}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export function isOnline() {
  // لا نعتبر الاتصال صالحًا إلا بعد تحقق فعلي ناجح.
  return state.verified === true && state.online === true;
}

export function getConnectionState() {
  return { ...state };
}

export function subscribeConnection(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function checkConnectivity({ timeout = 5000, silent = false } = {}) {
  if (monitoringStopped) return false;
  if (activeCheck) return activeCheck;

  activeCheck = (async () => {
    state.checking = true;
    if (!silent) notify();

    let success = false;
    let lastError = null;
    const targets = probeTargets();

    for (const target of targets) {
      try {
        await probe(target, timeout);
        success = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (monitoringStopped) return false;
    state.online = success;
    state.verified = true;
    state.lastError = success ? null : (lastError?.message || "تعذر الوصول إلى خادم فحص الاتصال");
    state.lastCheckedAt = new Date().toISOString();
    if (success) state.lastSuccessAt = state.lastCheckedAt;
    state.checking = false;
    notify();
    return success;
  })();

  try {
    return await activeCheck;
  } finally {
    activeCheck = null;
  }
}

window.addEventListener("online", () => checkConnectivity({ timeout: 4500, silent: true }));
window.addEventListener("offline", () => {
  if (monitoringStopped) return;
  state.online = false;
  state.verified = true;
  state.lastCheckedAt = new Date().toISOString();
  state.lastError = "أبلغ النظام بانقطاع الشبكة";
  notify();
  window.setTimeout(() => checkConnectivity({ timeout: 3500, silent: true }), 500);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkConnectivity({ timeout: 4500, silent: true });
  }
});

periodicCheckTimer = window.setInterval(() => {
  if (!monitoringStopped) checkConnectivity({ timeout: 4500, silent: true });
}, 15000);

function stopConnectivityMonitoring() {
  if (monitoringStopped) return;
  monitoringStopped = true;
  if (periodicCheckTimer !== null) {
    window.clearInterval(periodicCheckTimer);
    periodicCheckTimer = null;
  }
  listeners.clear();
}

window.addEventListener("pagehide", stopConnectivityMonitoring, { once: true });
window.addEventListener("beforeunload", stopConnectivityMonitoring, { once: true });
