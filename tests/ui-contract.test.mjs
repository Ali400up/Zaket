import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("V12.2 has an accessible backup wizard and calm responsive design tokens", async () => {
  const app = await read("js/app.js");
  const css = await read("css/styles.css");
  const html = await read("index.html");

  assert.match(app, /aria-live="polite"/);
  assert.match(app, /نسخة إدارية كاملة/);
  assert.match(app, /EXACT-RESTORE/);
  assert.match(app, /V2 محولة وستُطابق بصمتها على الخادم/);
  assert.match(app, /V1 قديمة غير موقعة/);
  assert.match(app, /لا يحذف ملفات المستخدمين أو حسابات Auth/);
  assert.match(css, /--focus-ring:/);
  assert.match(css, /\.primary-button:focus-visible/);
  assert.match(css, /\.switch input:checked \+ \.switch-slider/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(html, /Font Awesome\/i\.test\(s\.fontFamily\)/);
  assert.match(html, /fontawesome-missing/);
});
