import test from "node:test";
import assert from "node:assert/strict";

import { createBackupManagerHandler } from "../supabase/functions/backup-manager/handler.js";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test" }),
};
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function request(body, headers = {}) {
  return new Request("https://project.supabase.co/functions/v1/backup-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("backup manager rejects a request without a user access token", async () => {
  let clients = 0;
  const handler = createBackupManagerHandler({
    env: ENV,
    createClientImpl: () => { clients += 1; throw new Error("must not create a client"); },
    randomUUID: () => "req-no-auth",
  });

  const response = await handler(request({ action: "finish_export", payload: { session_id: SESSION_ID } }));
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error, "يجب تسجيل الدخول أولاً.");
  assert.equal(payload.request_id, "req-no-auth");
  assert.equal(clients, 0);
});

test("backup manager rejects a request without an approved-device fingerprint", async () => {
  let clients = 0;
  const handler = createBackupManagerHandler({
    env: ENV,
    createClientImpl: () => { clients += 1; throw new Error("must not create a client"); },
    randomUUID: () => "req-no-device",
  });

  const response = await handler(request(
    { action: "finish_export", payload: { session_id: SESSION_ID } },
    { Authorization: "Bearer user-access-token" },
  ));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "بصمة الجهاز مطلوبة.", request_id: "req-no-device" });
  assert.equal(clients, 0);
});

test("backup manager forwards the user token and device to one fixed RPC", async () => {
  const created = [];
  const rpcCalls = [];
  const authTokens = [];
  const client = {
    auth: { getUser: async token => {
      authTokens.push(token);
      return { data: { user: { id: "admin-1" } }, error: null };
    } },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: { session_id: SESSION_ID, ready: true }, error: null };
    },
  };
  const handler = createBackupManagerHandler({
    env: ENV,
    createClientImpl: (url, key, options) => { created.push({ url, key, options }); return client; },
    randomUUID: () => "req-ok",
  });

  const response = await handler(request(
    { action: "finish_export", payload: { session_id: SESSION_ID } },
    { Authorization: "Bearer user-access-token", "x-device-fingerprint": "device-9" },
  ));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { session_id: SESSION_ID, ready: true, request_id: "req-ok" });
  assert.deepEqual(authTokens, ["user-access-token"]);
  assert.deepEqual(rpcCalls, [{ name: "backup_v3_finish_export", args: { p_session_id: SESSION_ID } }]);
  assert.deepEqual(created, [{
    url: "https://project.supabase.co",
    key: "sb_publishable_test",
    options: {
      global: { headers: { Authorization: "Bearer user-access-token", "x-device-fingerprint": "device-9" } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  }]);
});

test("backup manager returns forbidden when the database rejects admin or device access", async () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-2" } }, error: null }) },
    rpc: async () => ({ data: null, error: { message: "هذه العملية متاحة لمدير النظام فقط" } }),
  };
  const handler = createBackupManagerHandler({ env: ENV, createClientImpl: () => client, randomUUID: () => "req-denied" });

  const response = await handler(request(
    { action: "preflight_restore", payload: { session_id: SESSION_ID } },
    { Authorization: "Bearer user-token", "x-device-fingerprint": "device" },
  ));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "هذه العملية متاحة لمدير النظام فقط", request_id: "req-denied" });
});

test("backup manager handles browser preflight without touching Supabase", async () => {
  const handler = createBackupManagerHandler({ env: ENV, createClientImpl: () => { throw new Error("unexpected"); } });
  const response = await handler(new Request("https://project.supabase.co/functions/v1/backup-manager", { method: "OPTIONS" }));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("access-control-allow-headers") || "", /x-device-fingerprint/);
});
