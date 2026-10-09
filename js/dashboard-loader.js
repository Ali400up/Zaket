const aborted = () => new DOMException("Dashboard superseded", "AbortError");
const retryable = error => error?.code === "57014" || error?.code === "DASHBOARD_TIMEOUT" || /statement timeout|failed to fetch|network error/i.test(error?.message || "");

// Independent, bounded read jobs. A failed section never supplies invented data.
export async function loadDashboardSections(sources, {
  signal, onUpdate = () => {}, concurrency = 2, timeoutMs = 12_000, retries = 1, retryDelayMs = 300
} = {}) {
  const snapshot = Object.fromEntries(sources.map(source => [source.key, { label: source.label || source.key, status: "loading", value: null, error: null, attempts: 0 }]));
  const queue = [...sources]; let next = 0;
  const publish = () => { if (!signal?.aborted) onUpdate({ ...snapshot }); };
  if (signal?.aborted) throw aborted();
  publish();
  async function attempt(source) {
    const controller = new AbortController(); let timer, rejectCancellation;
    const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
    const cancel = () => { controller.abort(); rejectCancellation(aborted()); };
    signal?.addEventListener("abort", cancel, { once: true });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error("انتهت مهلة تحميل القسم"), { code: "DASHBOARD_TIMEOUT" }));
        controller.abort();
      }, timeoutMs);
    });
    try {
      if (signal?.aborted) throw aborted();
      return await Promise.race([Promise.resolve().then(() => source.load({ signal: controller.signal })), deadline, cancellation]);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
  }
  async function worker() {
    while (next < queue.length && !signal?.aborted) {
      const source = queue[next++]; const previous = snapshot[source.key];
      snapshot[source.key] = { ...previous, status: previous.attempts ? "retrying" : "loading", attempts: previous.attempts + 1 };
      if (previous.attempts && retryDelayMs) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      if (signal?.aborted) return;
      try {
        const value = await attempt(source);
        if (signal?.aborted) return;
        snapshot[source.key] = { ...snapshot[source.key], status: "success", value, error: null };
      } catch (error) {
        if (signal?.aborted) return;
        const retry = snapshot[source.key].attempts <= retries && retryable(error);
        snapshot[source.key] = { ...snapshot[source.key], status: retry ? "retrying" : "error", value: null, error };
        if (retry) queue.push(source); // Retry after the other initial jobs, never all successful sections.
      }
      publish();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, sources.length)) }, worker));
  if (signal?.aborted) throw aborted();
  return { ...snapshot };
}
