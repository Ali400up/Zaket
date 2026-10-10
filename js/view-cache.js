// Screen snapshots live only in this tab. They never cross account/project scopes.
export function createViewCache({ ttlMs = 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    read(scope) {
      const entry = entries.get(scope);
      return entry ? { ...entry, fresh: entry.complete && !entry.invalid && now() - entry.savedAt < ttlMs } : null;
    },
    save(scope, value, { complete = true } = {}) {
      if (!scope) return;
      entries.set(scope, { value, complete, invalid: false, savedAt: now() });
      if (entries.size > 4) entries.delete(entries.keys().next().value);
    },
    invalidate() { for (const entry of entries.values()) entry.invalid = true; },
    clear() { entries.clear(); }
  };
}
