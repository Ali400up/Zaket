import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("file fields accept every browser image format and render preview plus progress", async () => {
  const app = await read("js/app.js");
  assert.match(app, /accept=.*image\/\*,application\/pdf/);
  assert.match(app, /data-attachment-preview/);
  assert.match(app, /data-attachment-progress/);
  assert.match(app, /prepareAttachment/);
  assert.match(app, /uploadPreparedAttachment/);
});

test("records with file fields expose an attachment viewer action", async () => {
  const app = await read("js/app.js");
  assert.match(app, /attachments:\s*\["fa-solid fa-paperclip"/);
  assert.match(app, /data-row-action="attachments"/);
  assert.match(app, /listEntityAttachments/);
  assert.match(app, /createAttachmentUrl/);
});

test("uploads use real XHR progress and immutable object names", async () => {
  const data = await read("js/data-service.js");
  assert.match(data, /async uploadPreparedAttachment\(/);
  assert.match(data, /XMLHttpRequest/);
  assert.match(data, /xhr\.upload\.addEventListener\("progress"/);
  assert.match(data, /x-upsert["']?,\s*["']false/);
  assert.match(data, /async finalizePendingAttachments\(/);
});

test("a failed record save cleans newly uploaded orphan files without deleting persisted attachments", async () => {
  const app = await read("js/app.js");
  assert.match(app, /cleanupUploadedAttachments/);
  assert.match(app, /if \(!recordPersisted\)/);
  assert.match(app, /تم حفظ السجل، لكن تعذر تسجيل فهرس المرفق/);
});

test("attachment surfaces have dedicated responsive styles", async () => {
  const css = await read("css/styles.css");
  assert.match(css, /\.attachment-preview/);
  assert.match(css, /\.attachment-progress/);
  assert.match(css, /\.attachment-viewer/);
});
