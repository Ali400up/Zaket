import test from "node:test";
import assert from "node:assert/strict";

import { createBackupManagerClient } from "../js/backup-edge-client.js";

test("live backup transport invokes the backup-manager Edge Function", async () => {
  const calls = [];
  const supabase = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options });
        return { data: { session_id: "server-session", ready: true }, error: null };
      },
    },
  };
  const client = createBackupManagerClient({
    supabase,
    functionName: "backup-manager",
    getFingerprint: () => "approved-device",
  });

  const result = await client.startExport({ scope: "business", consistent: true });

  assert.deepEqual(result, { session_id: "server-session", ready: true });
  assert.deepEqual(calls, [{
    name: "backup-manager",
    options: {
      body: { action: "start_export", payload: { scope: "business", consistent: true } },
      headers: { "x-device-fingerprint": "approved-device" },
    },
  }]);
});

test("live backup transport exposes the server request reference on failure", async () => {
  const supabase = {
    functions: {
      invoke: async () => ({
        data: { error: "الجهاز غير معتمد", request_id: "req-42" },
        error: null,
      }),
    },
  };
  const client = createBackupManagerClient({ supabase, getFingerprint: () => "device" });

  await assert.rejects(
    () => client.preflightRestore("11111111-1111-4111-8111-111111111111"),
    /الجهاز غير معتمد \(مرجع الطلب: req-42\)/,
  );
});

test("live backup transport maps every V3 operation to a fixed Edge action", async () => {
  const calls = [];
  const supabase = {
    functions: {
      invoke: async (_name, options) => {
        calls.push(options.body);
        return { data: { ok: true }, error: null };
      },
    },
  };
  const client = createBackupManagerClient({ supabase, getFingerprint: () => "device" });
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const manifest = { format: "zakat-backup-v3", tables: {} };

  await client.exportPart(sessionId, "beneficiaries", "b-1", 100);
  await client.finishExport(sessionId);
  await client.cancelExport(sessionId);
  await client.startRestore(manifest, "exact");
  await client.stageRestorePart(sessionId, "beneficiaries", 1, "[]", "a".repeat(64));
  await client.preflightRestore(sessionId);
  await client.commitRestore(sessionId, "EXACT-RESTORE");

  assert.deepEqual(calls, [
    { action: "export_part", payload: { session_id: sessionId, table: "beneficiaries", after_id: "b-1", limit: 100 } },
    { action: "finish_export", payload: { session_id: sessionId } },
    { action: "cancel_export", payload: { session_id: sessionId } },
    { action: "start_restore", payload: { manifest, mode: "exact" } },
    { action: "stage_restore_part", payload: { session_id: sessionId, table: "beneficiaries", part_no: 1, rows_text: "[]", checksum: "a".repeat(64) } },
    { action: "preflight_restore", payload: { session_id: sessionId } },
    { action: "commit_restore", payload: { session_id: sessionId, confirmation: "EXACT-RESTORE" } },
  ]);
});
