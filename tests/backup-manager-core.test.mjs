import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBackupManagerRequest } from "../supabase/functions/backup-manager/core.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CHECKSUM = "a".repeat(64);
const MANIFEST = {
  format: "zakat-backup-v3",
  scope: "business",
  checksum_algorithm: "sha256-postgres-jsonb-v1",
  tables: {},
};

test("backup manager maps an export request only to its fixed RPC", () => {
  assert.deepEqual(
    normalizeBackupManagerRequest({
      action: "export_part",
      payload: { session_id: SESSION_ID, table: "beneficiaries", after_id: "b-10", limit: 75 },
    }),
    {
      action: "export_part",
      rpc: "backup_v3_export_part",
      args: {
        p_session_id: SESSION_ID,
        p_table: "beneficiaries",
        p_after_id: "b-10",
        p_limit: 75,
      },
    },
  );
});

test("backup manager rejects an unknown action instead of accepting an arbitrary RPC", () => {
  assert.throws(
    () => normalizeBackupManagerRequest({ action: "drop_database", payload: {} }),
    /عملية النسخ المطلوبة غير مسموحة/,
  );
});

test("backup manager rejects a syntactically valid table outside the backup allow-list", () => {
  assert.throws(
    () => normalizeBackupManagerRequest({
      action: "export_part",
      payload: { session_id: SESSION_ID, table: "private_notes", limit: 50 },
    }),
    /الجدول غير مسموح في النسخة/,
  );
});

test("backup manager rejects a restore manifest that names an unlisted table", () => {
  assert.throws(
    () => normalizeBackupManagerRequest({
      action: "start_restore",
      payload: {
        mode: "merge",
        manifest: { ...MANIFEST, tables: { private_notes: { row_count: 0, parts: [] } } },
      },
    }),
    /جدولاً غير مسموح/,
  );
});

test("backup manager rejects an oversized restore part before reaching Postgres", () => {
  assert.throws(
    () => normalizeBackupManagerRequest({
      action: "stage_restore_part",
      payload: {
        session_id: SESSION_ID,
        table: "beneficiaries",
        part_no: 1,
        rows_text: "x".repeat(450001),
        checksum: CHECKSUM,
      },
    }),
    /يتجاوز الحد الآمن/,
  );
});

test("backup manager requires an explicit restore confirmation phrase", () => {
  assert.throws(
    () => normalizeBackupManagerRequest({
      action: "commit_restore",
      payload: { session_id: SESSION_ID, confirmation: "yes" },
    }),
    /عبارة تأكيد الاستعادة غير صحيحة/,
  );
});

test("backup manager exposes only the eight fixed V3 operations", () => {
  const cases = [
    [{ action: "start_export", payload: { scope: "administrative", consistent: false } }, "backup_v3_start_export", { p_scope: "administrative", p_consistent: false }],
    [{ action: "finish_export", payload: { session_id: SESSION_ID } }, "backup_v3_finish_export", { p_session_id: SESSION_ID }],
    [{ action: "cancel_export", payload: { session_id: SESSION_ID } }, "backup_v3_cancel_export", { p_session_id: SESSION_ID }],
    [{ action: "start_restore", payload: { manifest: MANIFEST, mode: "merge" } }, "backup_v3_start_restore", { p_manifest: MANIFEST, p_mode: "merge" }],
    [{ action: "stage_restore_part", payload: { session_id: SESSION_ID, table: "beneficiaries", part_no: 2, rows_text: "[]", checksum: CHECKSUM } }, "backup_v3_stage_restore_part", { p_session_id: SESSION_ID, p_table: "beneficiaries", p_part_no: 2, p_rows_text: "[]", p_checksum: CHECKSUM }],
    [{ action: "preflight_restore", payload: { session_id: SESSION_ID } }, "backup_v3_preflight_restore", { p_session_id: SESSION_ID }],
    [{ action: "commit_restore", payload: { session_id: SESSION_ID, confirmation: "MERGE-RESTORE" } }, "backup_v3_commit_restore", { p_session_id: SESSION_ID, p_confirmation: "MERGE-RESTORE" }],
  ];

  for (const [request, rpc, args] of cases) {
    assert.deepEqual(normalizeBackupManagerRequest(request), { action: request.action, rpc, args });
  }
});
