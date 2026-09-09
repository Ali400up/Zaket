import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { healthMetric, describeHealthError } from "../js/system-health.js";

// Execute the actual settings and status renderer with read-only DOM/service
// substitutes. This checks the reported blank screen, not SQL text patterns.
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const renderer = app.slice(app.indexOf("function storageMeter("), app.indexOf("function releaseNotesMarkup("));
const settings = app.slice(app.indexOf("let settingsRenderRevision = 0;"), app.indexOf("async function saveSettings("));
function environment(dataService) {
  const controls = [{ disabled: false }];
  const pageContent = { innerHTML: "", querySelectorAll: () => controls };
  const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const context = vm.createContext({
    healthMetric, describeHealthError, dataService,
    config: { version: "12.5.0", releaseName: "الواجهة الزرقاء المحسّنة" },
    state: { currentScreen: "settings", session: { profile: { role: "admin" } } },
    els: { pageContent }, localStorage: { getItem: () => null }, applyFontScale() {},
    getOfflineQueue: () => [], getConnectionState: () => ({}), getDeviceName: () => "جهاز الاختبار",
    escapeHtml, formatFileSize: value => `${value} bytes`, formatNumber: String, formatDate: String,
    AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(renderer + "\n" + settings, context);
  return { context, pageContent, controls };
}

test("status RPC errors keep the page, local information, cause, and retry visible", async () => {
  const { context, pageContent } = environment({
    list: async () => ({ data: [{ id: 1 }] }),
    getSystemHealth: async () => ({ cache_bytes: 512, live_unavailable: true, diagnostic_code: "42703", diagnostic_error: 'column "revision" does not exist <script>' }),
  });
  await vm.runInContext('renderSettings("system")', context);
  assert.match(pageContent.innerHTML, /حالة النظام/);
  assert.match(pageContent.innerHTML, /512 bytes/);
  assert.match(pageContent.innerHTML, /تحديث الحالة/);
  assert.match(pageContent.innerHTML, /42703/);
  assert.match(pageContent.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(pageContent.innerHTML, /<script>|كل الفحوص متوازنة|لا توجد ملفات مفقودة|المتبقي:/);
});

test("a missing settings view does not hide diagnostics or enable saving empty defaults", async () => {
  const { context, pageContent, controls } = environment({
    list: async () => { throw Object.assign(new Error('relation "v_system_settings" does not exist'), { code: "42P01" }); },
    getSystemHealth: async () => ({ database_bytes: 2000, financial_integrity_failures: 0, schema_missing_objects: 1 }),
  });
  await vm.runInContext('renderSettings("system")', context);
  assert.match(pageContent.innerHTML, /تعذر تحميل الإعدادات المحفوظة/);
  assert.match(pageContent.innerHTML, /2000 bytes/);
  assert.match(pageContent.innerHTML, /عنصرًا يحتاج إصلاحًا/);
  assert.equal(controls[0].disabled, true);
});

test("a rejected diagnostic promise still renders an unknown state with navigation", async () => {
  const { context, pageContent } = environment({
    list: async () => ({ data: [{ id: 1 }] }),
    getSystemHealth: async () => { throw new Error("تعذر الاتصال"); },
  });
  await vm.runInContext('renderSettings("system")', context);
  assert.match(pageContent.innerHTML, /data-settings-tab="general"/);
  assert.match(pageContent.innerHTML, /القياس غير متاح/);
  assert.match(pageContent.innerHTML, /تعذر الاتصال/);
});
