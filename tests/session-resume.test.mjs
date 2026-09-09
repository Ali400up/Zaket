import test from "node:test";
import assert from "node:assert/strict";

import { markSessionResume, shouldRecordSessionResume, sessionResumeKey } from "../js/session-audit.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test("records a restored Supabase session once per browser tab", () => {
  const storage = memoryStorage();
  assert.equal(shouldRecordSessionResume(storage, "session-a"), true);
  markSessionResume(storage, "session-a");
  assert.equal(storage.getItem(sessionResumeKey("session-a")), "1");
  assert.equal(shouldRecordSessionResume(storage, "session-a"), false);
});

test("a new server session is independently auditable", () => {
  const storage = memoryStorage();
  markSessionResume(storage, "session-a");
  assert.equal(shouldRecordSessionResume(storage, "session-b"), true);
});

test("missing or invalid session identifiers never create a marker", () => {
  const storage = memoryStorage();
  assert.equal(shouldRecordSessionResume(storage, ""), false);
  assert.equal(markSessionResume(storage, ""), false);
});

