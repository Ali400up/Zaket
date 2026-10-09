import { normalizeSearchText } from "./searchable-select.js";

// This is a search index, never a financial or full beneficiary record cache.
export const BENEFICIARY_INDEX_FIELDS = "id,full_name,file_no,status,delegate_id,created_at,updated_at";
const INDEX_FIELDS = BENEFICIARY_INDEX_FIELDS.split(",");
const PAGE_SIZE = 500;

export function beneficiaryCacheScope(scope = {}) {
  if (!scope?.userId) return "";
  return JSON.stringify([
    String(scope.project || "demo").trim().replace(/\/+$/, ""),
    String(scope.userId), scope.role || "", scope.delegateId || "", scope.branchId || "", scope.device || ""
  ]);
}

export function createIndexedDbStore(indexedDB = globalThis.indexedDB) {
  let database;
  const open = () => database ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open("zakat-beneficiary-search-v1", 1);
    let expired = false;
    const timeout = setTimeout(() => { expired = true; reject(new Error("IndexedDB blocked")); }, 1500);
    request.onupgradeneeded = () => {
      const db = request.result;
      const rows = db.createObjectStore("rows", { keyPath: ["scope", "id"] });
      rows.createIndex("scope", "scope");
      db.createObjectStore("meta", { keyPath: "scope" });
    };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  const transaction = async (mode, operation) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["rows", "meta"], mode);
      let result;
      tx.oncomplete = () => resolve(typeof result === "function" ? result() : result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      try { result = operation(tx.objectStore("rows"), tx.objectStore("meta")); }
      catch (error) { tx.abort(); reject(error); }
    });
  };
  function removeScope(rows, scope, after) {
    const request = rows.index("scope").openCursor(scope);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
      else after?.();
    };
  }
  return {
    read: scope => transaction("readonly", (rows, meta) => {
      const records = rows.index("scope").getAll(scope);
      const metadata = meta.get(scope);
      return () => metadata.result ? { ...metadata.result, rows: records.result.map(record => record.row) } : null;
    }),
    replace: (scope, records, metadata) => transaction("readwrite", (rows, meta) => {
      removeScope(rows, scope, () => {
        records.forEach(row => rows.put({ scope, id: row.id, row }));
        meta.put({ scope, ...metadata });
      });
    }),
    change: (scope, row, id, metadata) => transaction("readwrite", (rows, meta) => {
      if (row) rows.put({ scope, id: row.id, row });
      else rows.delete([scope, String(id)]);
      meta.put({ scope, ...metadata });
    }),
    clear: scope => transaction("readwrite", (rows, meta) => { removeScope(rows, scope); meta.delete(scope); }),
    async close() { if (database) (await database.catch(() => null))?.close(); database = null; }
  };
}

export function createBeneficiaryDirectory({
  fetchPage, fetchById, fetchFingerprint, store = createIndexedDbStore(),
  isOnline = () => globalThis.navigator?.onLine !== false,
  now = () => Date.now(), onChange = () => {}
}) {
  let scope = null, scopeKey = "", generation = 0;
  let records = new Map(), ready = false, activeRefresh = null, activation = Promise.resolve();
  let mutationRevision = 0, mutations = new Map(), idRevisions = new Map(), idRequests = new Map(), snapshotRevision = 0;
  let fingerprint = null, lastFullSync = 0, savedAt = null;
  let writeChain = Promise.resolve(), persistent = true;
  let stopWatching = () => {}, pollTimer = null, realtimeTimer = null;
  const listeners = new Set();
  const notify = () => { onChange(); listeners.forEach(listener => listener()); };
  function allowed(row) {
    return scope?.role !== "distributor" || Boolean(scope.delegateId && String(row.delegate_id || "") === String(scope.delegateId));
  }
  function project(row) {
    const small = Object.fromEntries(INDEX_FIELDS.map(field => [field, row[field] ?? null]));
    small.id = String(row.id);
    return { row: small, name: normalizeSearchText(row.full_name).replace(/\s/g, ""), file: normalizeSearchText(row.file_no).replace(/\s/g, "") };
  }
  function put(map, row) { if (row?.id != null && allowed(row)) map.set(String(row.id), project(row)); }
  const rows = () => [...records.values()].map(entry => ({ ...entry.row }));
  const metadata = () => ({ complete: ready, savedAt, fingerprint, lastFullSync });
  function write(operation) {
    const task = writeChain.then(operation).catch(() => { persistent = false; });
    writeChain = task; return task;
  }
  function assertCurrent(epoch) {
    if (epoch !== generation || !scopeKey) throw new DOMException("Account changed", "AbortError");
  }

  const directory = {
    get scopeKey() { return scopeKey; },
    capture() { return { scopeKey, generation }; },
    isCurrent(token) { return Boolean(scopeKey && token?.scopeKey === scopeKey && token.generation === generation); },
    get status() { return { ready, savedAt, persistent, size: records.size }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async activate(nextScope) {
      const nextKey = beneficiaryCacheScope(nextScope);
      if (scopeKey === nextKey) return activation;
      const previousKey = scopeKey;
      directory.stopWatching(); generation += 1;
      const epoch = generation;
      scope = nextScope; scopeKey = nextKey;
      records = new Map(); ready = false; activeRefresh = null;
      mutations = new Map(); idRevisions = new Map(); idRequests = new Map(); mutationRevision = 0; snapshotRevision = 0;
      fingerprint = null; lastFullSync = 0; savedAt = null;
      notify();
      activation = (async () => {
        if (previousKey) await write(() => store.clear(previousKey));
        if (!nextKey) return;
        let cached;
        try { cached = await store.read(nextKey); } catch { persistent = false; }
        if (epoch !== generation) return;
        // A fresh disk snapshot is reusable only after a scoped server check.
        // Older snapshots are reconciled completely, even if the fingerprint matches.
        let reusable = cached?.complete && !isOnline();
        if (cached?.complete && isOnline() && fetchFingerprint && now() - (cached.lastFullSync || 0) < 5 * 60_000) {
          let latest;
          // Disk reuse is optional. A transient check failure must not poison
          // activation permanently; the next search retries a complete fetch.
          try { latest = await fetchFingerprint(); } catch { latest = undefined; }
          if (epoch !== generation) return;
          reusable = latest !== undefined && latest === cached.fingerprint;
        }
        if (reusable) {
          (cached.rows || []).forEach(row => put(records, row));
          ready = true; savedAt = cached.savedAt; lastFullSync = cached.lastFullSync || 0;
          fingerprint = cached.fingerprint; notify();
        }
      })();
      return activation;
    },
    async clear() { await directory.activate(null); },
    async ensureReady() {
      await activation;
      if (!scopeKey) throw new Error("يجب تسجيل الدخول للبحث في المستفيدين.");
      if (ready) return;
      await directory.refresh();
    },
    async refresh() {
      await activation;
      if (activeRefresh) return activeRefresh;
      if (!isOnline()) {
        if (!ready) throw new Error("يلزم الاتصال لتحميل دليل المستفيدين أول مرة.");
        return;
      }
      const epoch = generation, key = scopeKey;
      assertCurrent(epoch);
      const task = (async () => {
        // The complete map is published atomically, never a partial first page.
        let next, latest, attemptRevision;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          attemptRevision = mutationRevision;
          const before = await fetchFingerprint?.(); assertCurrent(epoch);
          next = new Map(); let afterId = null;
          while (true) {
            const batch = await fetchPage({ afterId, limit: PAGE_SIZE }); assertCurrent(epoch);
            if (!Array.isArray(batch)) throw new Error("استجابة غير صالحة لدليل المستفيدين.");
            if (!batch.length) break;
            const lastId = String(batch.at(-1).id || "");
            if (!lastId || (afterId && lastId <= afterId)) throw new Error("تعذر إكمال ترتيب دليل المستفيدين.");
            batch.forEach(row => put(next, row)); afterId = lastId;
            // A short page is not EOF: projects can configure limits below 500.
          }
          latest = await fetchFingerprint?.(); assertCurrent(epoch);
          if (before === latest) break;
          if (attempt === 2) throw new Error("يتغير دليل المستفيدين أثناء التحميل. أعد المحاولة بعد انتهاء الاستيراد.");
        }
        mutations.forEach((entry, id) => {
          if (entry.revision <= attemptRevision) return;
          const fetched = next.get(id)?.row;
          if (entry.row?.updated_at && fetched?.updated_at && String(fetched.updated_at) > String(entry.row.updated_at)) return;
          next.delete(id); if (entry.row) put(next, entry.row);
        });
        records = next; snapshotRevision += 1; ready = true; savedAt = new Date(now()).toISOString();
        fingerprint = latest ?? null; lastFullSync = now();
        mutations.clear();
        const snapshot = rows(), meta = metadata();
        await write(async () => { if (epoch === generation) await store.replace(key, snapshot, meta); });
        assertCurrent(epoch); notify();
      })();
      activeRefresh = task;
      try { await task; } finally { if (activeRefresh === task) activeRefresh = null; }
    },
    query(search = "", { filters = {}, page = 1, pageSize = 20, orderBy = "id", ascending = true, dateKey, dateFrom, dateTo } = {}) {
      const term = normalizeSearchText(search).replace(/\s/g, "");
      const matches = [...records.values()].filter(entry => {
        const row = entry.row;
        if (term && !entry.name.includes(term) && !entry.file.includes(term)) return false;
        if (Object.entries(filters).some(([field, value]) => value != null && value !== "" && String(row[field]) !== String(value))) return false;
        if (dateKey && dateFrom && String(row[dateKey] || "") < dateFrom) return false;
        if (dateKey && dateTo && String(row[dateKey] || "") > (dateKey.endsWith("_at") ? `${dateTo}T23:59:59.999` : dateTo)) return false;
        return true;
      });
      matches.sort((a,b) => {
        const comparison = String(a.row[orderBy] ?? "").localeCompare(String(b.row[orderBy] ?? ""));
        return (ascending ? comparison : -comparison) || String(a.row.id).localeCompare(String(b.row.id));
      });
      const size = Math.max(1, Math.floor(Number(pageSize) || 20));
      const total = matches.length, totalPages = Math.max(1, Math.ceil(total / size));
      const currentPage = Math.max(1, Math.min(totalPages, Math.floor(Number(page) || 1)));
      return { data: matches.slice((currentPage - 1) * size, currentPage * size).map(entry => ({ ...entry.row })), total, page: currentPage, totalPages, source: "index", cachedAt: savedAt };
    },
    all(filters = {}) { return directory.query("", { filters, pageSize: Math.max(1, records.size) }).data; },
    async change(row, removedId) {
      const id = String(row?.id || removedId || "");
      if (!scopeKey || !id || row?._queued) return;
      const epoch = generation, key = scopeKey;
      const current = records.get(id)?.row;
      if (row?.updated_at && current?.updated_at && String(current.updated_at) > String(row.updated_at)) return;
      records.delete(id); const value = row && allowed(row) ? project(row).row : null;
      if (value) put(records, value);
      mutationRevision += 1;
      idRevisions.set(id, mutationRevision);
      if (activeRefresh) mutations.set(id, { revision: mutationRevision, row: value });
      savedAt = new Date(now()).toISOString(); const meta = metadata();
      notify();
      await write(async () => { if (epoch === generation) await store.change(key, value, id, meta); });
    },
    async handleRealtime(payload) {
      const id = payload?.new?.id || payload?.old?.id;
      if (!id || !scopeKey) return;
      if (payload.eventType === "DELETE") { await directory.change(null, String(id)); return; }
      const rowId = String(id), epoch = generation, revision = idRevisions.get(rowId), snapshot = snapshotRevision;
      const request = (idRequests.get(rowId) || 0) + 1;
      idRequests.set(rowId, request);
      const row = await fetchById(rowId);
      if (epoch !== generation || request !== idRequests.get(rowId) || snapshot !== snapshotRevision || revision !== idRevisions.get(rowId)) return;
      await directory.change(row, rowId);
    },
    async poll({ force = false } = {}) {
      if (!scopeKey || !isOnline()) return;
      if (!ready) { await directory.ensureReady(); return; }
      const epoch = generation;
      const latest = await fetchFingerprint?.(); assertCurrent(epoch);
      // Periodic reconciliation also removes deleted/reassigned rows after
      // missed Realtime events, including equal-count changes.
      if (force || latest !== fingerprint || now() - lastFullSync >= 5 * 60_000) await directory.refresh();
    },
    startWatching({ subscribe, pollMs = 45_000, onError = () => {} } = {}) {
      directory.stopWatching();
      const epoch = generation;
      const check = () => directory.poll().catch(onError);
      pollTimer = setInterval(check, pollMs);
      pollTimer?.unref?.();
      // Subscription merely listens: it never creates publications or policies.
      const stop = subscribe?.(payload => {
        if (epoch !== generation) return;
        directory.handleRealtime(payload).catch(onError);
      }, status => {
        if (epoch !== generation || status !== "SUBSCRIBED") return;
        clearTimeout(realtimeTimer); realtimeTimer = setTimeout(check, 250);
      });
      stopWatching = typeof stop === "function" ? stop : () => {};
    },
    stopWatching() {
      clearInterval(pollTimer); clearTimeout(realtimeTimer); pollTimer = realtimeTimer = null;
      stopWatching(); stopWatching = () => {};
    }
  };
  return directory;
}
