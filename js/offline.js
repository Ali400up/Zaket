const QUEUE_KEY = "zakat_offline_queue_v1";

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent("zakat:queue-change", { detail: queue }));
}

export function getOfflineQueue() {
  return readQueue();
}

export function queueOperation(operation) {
  const queue = readQueue();
  const item = {
    id: crypto.randomUUID(),
    idempotencyKey: operation.idempotencyKey || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "queued",
    error: null,
    ...operation
  };
  queue.unshift(item);
  writeQueue(queue);
  return item;
}

export function updateQueueItem(id, patch) {
  const queue = readQueue().map(item => item.id === id ? { ...item, ...patch } : item);
  writeQueue(queue);
  return queue.find(item => item.id === id);
}

export function removeQueueItem(id) {
  writeQueue(readQueue().filter(item => item.id !== id));
}

export function clearCompletedQueue() {
  writeQueue(readQueue().filter(item => item.status !== "synced"));
}

export async function syncOfflineQueue(executor) {
  const queue = readQueue();
  if (!navigator.onLine || !queue.length) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  for (const item of [...queue].reverse()) {
    if (item.status === "synced") continue;
    updateQueueItem(item.id, { status: "syncing", attempts: item.attempts + 1 });
    try {
      await executor(item);
      updateQueueItem(item.id, { status: "synced", syncedAt: new Date().toISOString(), error: null });
      synced++;
    } catch (error) {
      updateQueueItem(item.id, { status: "failed", error: error?.message || String(error) });
      failed++;
    }
  }
  return { synced, failed };
}
