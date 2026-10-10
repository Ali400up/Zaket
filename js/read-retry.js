const aborted = () => new DOMException("Read superseded", "AbortError");
const transient = error => ["57014","READ_TIMEOUT"].includes(error?.code) || /statement timeout|failed to fetch|network error|load failed/i.test(error?.message || "");

function wait(delay, signal) {
  return new Promise((resolve,reject) => {
    if (signal?.aborted) return reject(aborted());
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort",cancel); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort",cancel); resolve(); },delay);
    signal?.addEventListener("abort",cancel,{ once: true });
  });
}

// A read must complete or make page progress before its inactivity deadline.
// Leaving the screen cancels the request and backoff; access/schema errors fail.
export async function readWithRetry(load, {
  signal, timeoutMs = 12_000, retryDelayMs = 1_000, maxRetryDelayMs = 30_000, onRetry = () => {}
} = {}) {
  let delay = Math.max(1,retryDelayMs);
  while (true) {
    if (signal?.aborted) throw aborted();
    const controller = new AbortController(); let timer, cancel, progress, active = true;
    const interrupted = new Promise((_,reject) => {
      cancel = () => { active = false; controller.abort(); reject(aborted()); };
      signal?.addEventListener("abort",cancel,{ once: true });
      progress = () => {
        if (!active || controller.signal.aborted || signal?.aborted) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          active = false;
          reject(Object.assign(new Error("انتهت مهلة القراءة"),{ code: "READ_TIMEOUT" }));
          controller.abort();
        },timeoutMs);
      };
      progress();
    });
    let retry;
    try { return await Promise.race([Promise.resolve().then(() => load({ signal: controller.signal, progress })),interrupted]); }
    catch (error) {
      if (signal?.aborted) throw aborted();
      if (!transient(error)) throw error;
      retry = error;
    } finally { active = false; clearTimeout(timer); signal?.removeEventListener("abort",cancel); }
    onRetry(retry);
    await wait(delay,signal);
    delay = Math.min(Math.max(delay,maxRetryDelayMs),delay * 2);
  }
}
