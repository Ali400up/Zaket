import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");



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
  globalThis.window = { ZAKAT_CONFIG: { version: "12.5.0" } };
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



test("routes every live V3 operation through the deployed backup-manager function", async () => {
  const service = await read("js/data-service.js");
  const client = await read("js/backup-edge-client.js");
  const config = await read("supabase/config.toml");
  const worker = await read("service-worker.js");

  assert.match(service, /createBackupManagerClient/);
  assert.match(service, /getLiveBackupManager\(\)\.startExport/);
  assert.match(service, /getLiveBackupManager\(\)\.stageRestorePart/);
  assert.match(service, /getLiveBackupManager\(\)\.commitRestore/);
  assert.doesNotMatch(service, /supabase\.rpc\(["']backup_v3_/);
  assert.match(client, /supabase\.functions\.invoke\(functionName/);
  assert.match(config, /\[functions\.backup-manager\][\s\S]*verify_jwt\s*=\s*true/);
  assert.match(worker, /\/js\/backup-edge-client\.js/);
});
