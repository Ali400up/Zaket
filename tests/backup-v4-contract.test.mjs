import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("V4 backup contract includes every Storage object with a digest", async () => {
  const { buildTableRestoreManifest, normalizeStorageInventory, storageArchivePath } = await import("../js/backup-v4.js");
  const inventory = normalizeStorageInventory([
    { name: "docs/b.pdf", size: 9, mimetype: "application/pdf", updated_at: "2026-01-02" },
    { name: "profiles/a.webp", metadata: { size: 5, mimetype: "image/webp" }, updated_at: "2026-01-01" },
  ]);
  assert.deepEqual(inventory.map(item => [item.path, item.size]), [["docs/b.pdf", 9], ["profiles/a.webp", 5]]);
  assert.equal(storageArchivePath(12), "storage/files/file-000012.bin");
  assert.deepEqual(buildTableRestoreManifest({ format: "zakat-backup-v4", tables: {}, files: [] }), {
    format: "zakat-backup-v3",
    tables: {},
  });
});

test("V4 implementation refuses partial archives and restores files before committing data", async () => {
  const source = await read("js/backup-v4.js");
  const app = await read("js/app.js");
  const sql = await read("supabase/database_complete.sql");

  assert.match(source, /zakat-backup-v4/);
  assert.match(source, /sha256/i);
  assert.match(source, /لم تُنشأ نسخة ناقصة/);
  assert.match(source, /restoreV4Files/);
  assert.match(source, /cleanupExactV4Files/);
  assert.match(app, /restoreV4Files[\s\S]*commitRestoreV3[\s\S]*cleanupExactV4Files/);
  assert.match(sql, /backup_v4_list_storage_files/);
  assert.match(sql, /FROM storage\.objects/);
});

test("backup UI identifies V4 and no longer claims that Storage is excluded", async () => {
  const app = await read("js/app.js");
  assert.match(app, /النسخ الاحتياطي V4/);
  assert.match(app, /جميع المرفقات/);
  assert.doesNotMatch(app, /لا تشمل[\s\S]{0,100}Supabase Storage/);
});

test("V4 file restore is idempotent and exact cleanup runs only on extra paths", async () => {
  const { restoreV4Files, cleanupExactV4Files } = await import("../js/backup-v4.js");
  const { sha256Blob } = await import("../js/attachment-manager.js");
  const blob = new Blob(["attachment"], { type: "image/webp" });
  const digest = await sha256Blob(blob);
  const objects = new Map([["old/extra.bin", new Blob(["old"])]]);
  let uploads = 0;
  const dataService = {
    listStorageFiles: async () => [...objects].map(([name, value]) => ({ name, size: value.size })),
    downloadStorageFile: async path => objects.get(path),
    uploadStorageFile: async (path, value) => { uploads += 1; objects.set(path, value); },
    deleteStorageFiles: async paths => paths.forEach(path => objects.delete(path)),
  };
  const inspection = {
    manifest: { format: "zakat-backup-v4", files: [{ storage_path: "docs/a.webp", archive_path: "storage/files/file-000001.bin", size: blob.size, mime_type: blob.type, sha256: digest }] },
    checksums: { manifest: "a".repeat(64) },
    totalFiles: 1,
    zip: { file: () => ({ async: async () => blob }) },
  };

  assert.deepEqual(await restoreV4Files(dataService, inspection), { restored: 1, skipped: 0 });
  assert.deepEqual(await restoreV4Files(dataService, inspection), { restored: 0, skipped: 1 });
  assert.equal(uploads, 1);
  assert.deepEqual(await cleanupExactV4Files(dataService, inspection), { removed: 1 });
  assert.deepEqual([...objects.keys()], ["docs/a.webp"]);
});
