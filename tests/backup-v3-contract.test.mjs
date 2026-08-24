import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("V3 backup uses short staged export and restore contracts instead of one archive RPC", async () => {
  const sql = await read("supabase/database_complete.sql");
  const app = await read("js/app.js");
  const service = await read("js/data-service.js");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.backup_export_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.backup_restore_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.backup_restore_parts/);
  assert.match(sql, /backup_v3_start_export/);
  assert.match(sql, /backup_v3_export_part/);
  assert.match(sql, /backup_v3_finish_export/);
  assert.match(sql, /backup_v3_cancel_export/);
  assert.match(sql, /backup_v3_start_restore/);
  assert.match(sql, /backup_v3_stage_restore_part/);
  assert.match(sql, /backup_v3_preflight_restore/);
  assert.match(sql, /'warnings',v_warnings/);
  assert.match(sql, /'kind','current_integrity'/);
  assert.match(app, /const warnings = Array\.isArray\(report\.warnings\)/);
  assert.match(app, /backup-warnings/);
  assert.match(sql, /backup_v3_commit_restore/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /assert_financial_integrity\(\)/);
  assert.match(sql, /zakat\.backup_write_override'[\s\S]*zakat\.suppress_backup_revision'[\s\S]*backup_v3_export_started/);
  assert.match(sql, /RETURN jsonb_build_object\('failed',true,'error','تغيرت البيانات أثناء النسخ/);
  assert.match(sql, /v_limit:=GREATEST\(1,floor\(v_limit\/2\.0\)::integer\)/);
  assert.match(sql, /legacy_source_checksum/);
  assert.match(sql, /بصمة نسخة V2 الأصلية لا تطابق/);
  assert.match(sql, /'kind','field_shape'/);
  assert.match(sql, /عدد صفوف الجزء يجب أن يكون بين 1 و150/);
  assert.match(sql, /'rolled_back',true/);
  assert.match(sql, /already_completed/);
  assert.match(sql, /v_table='profiles'[\s\S]*target\.id IS DISTINCT FROM \$3::uuid/);
  assert.match(sql, /jsonb_build_object\('role','admin','status','active','is_active',true,'expires_at',NULL\)/);
  assert.match(sql, /CHECK\s*\(\s*part_no\s*>\s*0/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.restore_application_backup/);
  assert.match(service, /startBackupV3/);
  assert.match(service, /cancelBackupV3/);
  assert.match(service, /stageRestoreV3Part/);
  assert.match(service, /utf8ByteLength\(safeText\)/);
  assert.match(app, /data-backup-v3-create/);
  assert.match(app, /data-backup-v3-restore/);
});

test("V3 format verifies every archive part and blocks dangerous ZIP paths", async () => {
  const source = await read("js/backup-v3.js");
  const { validateArchivePath, normalizeLegacyBackup, sha256Hex, createV3Archive } = await import("../js/backup-v3.js");

  assert.match(source, /zakat-backup-v3/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /checksums\.json/);
  assert.match(source, /integrity-before\.json/);
  assert.match(source, /README-RESTORE\.txt/);
  assert.match(source, /SHA-256/);
  assert.match(source, /validateArchivePath/);
  assert.match(source, /splitLegacyRows/);
  assert.match(source, /legacy_source_checksum/);
  assert.match(source, /cancelBackupV3/);
  assert.equal(validateArchivePath("tables/beneficiaries/chunk-000001.json"), true);
  assert.throws(() => validateArchivePath("../manifest.json"), /غير آمن/);
  assert.equal(await sha256Hex("zakat"), "f31a738845dd10e73de905943103e193dad2b5aab42ab88b85551c9cb728ca16");
  const legacy = await normalizeLegacyBackup({
    format: "zakat-backup-v2",
    checksum: "a".repeat(64),
    tables: { branches: [{ id: "a", name: "فرع" }] }
  });
  assert.equal(legacy.manifest.format, "zakat-backup-v3");
  assert.equal(legacy.parts.length, 1);
  await assert.rejects(
    normalizeLegacyBackup({ format: "zakat-backup-v2", tables: { branches: [] } }),
    /بصمة SHA-256 صالحة/
  );
  let cancelledSession = null;
  globalThis.window = { ZAKAT_CONFIG: { version: "12.2.0" } };
  try {
    await assert.rejects(createV3Archive({
      startBackupV3: async () => ({ session_id: "session-cancel", tables: [], data_revision: 1 }),
      cancelBackupV3: async sessionId => { cancelledSession = sessionId; }
    }), /مكتبة ZIP غير متاحة/);
  } finally {
    delete globalThis.window;
  }
  assert.equal(cancelledSession, "session-cancel");
});

test("V12.1 upgrade block installs assistant knowledge before V3 and backs it up only administratively", async () => {
  const sql = await read("supabase/database_complete.sql");
  const marker = sql.indexOf("V12.1 — resumable application backup / restore V3");
  assert.ok(marker >= 0, "V12.1 upgrade marker is required");
  const upgrade = sql.slice(marker);
  const knowledge = upgrade.indexOf("CREATE TABLE IF NOT EXISTS public.system_knowledge_articles");
  const backup = upgrade.indexOf("CREATE TABLE IF NOT EXISTS public.backup_data_state");
  assert.ok(knowledge > 0 && backup > knowledge, "the contiguous upgrade must install knowledge before V3 triggers");
  assert.match(upgrade, /'system_settings','system_knowledge_articles'/);
  assert.match(upgrade, /'ai_action_requests','system_knowledge_articles'/);
  assert.match(upgrade, /'branches','system_knowledge_articles','system_settings'/);
});

test("V12.2 routes every live V3 operation through the deployed backup-manager function", async () => {
  const service = await read("js/data-service.js");
  const client = await read("js/backup-edge-client.js");
  const config = await read("supabase/config.toml");
  const worker = await read("service-worker.js");

  assert.match(service, /createBackupManagerClient/);
  assert.match(service, /liveBackupManager\.startExport/);
  assert.match(service, /liveBackupManager\.stageRestorePart/);
  assert.match(service, /liveBackupManager\.commitRestore/);
  assert.doesNotMatch(service, /supabase\.rpc\(["']backup_v3_/);
  assert.match(client, /supabase\.functions\.invoke\(functionName/);
  assert.match(config, /\[functions\.backup-manager\][\s\S]*verify_jwt\s*=\s*true/);
  assert.match(worker, /\/js\/backup-edge-client\.js/);
});
