import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");



test("assistant UI exposes safe report, navigation, and confirmation affordances", async () => {
  const ai = await read("js/ai-assistant.js");
  const app = await read("js/app.js");

  assert.match(ai, /data-ai-suggestion/);
  assert.match(ai, /data-ai-download-report/);
  assert.match(ai, /renderAssistantExtras\(root\);[\s\S]*const log = root\.querySelector\("#ai-chat-log"\)/);
  assert.doesNotMatch(ai, /if \(safety\)[^\n]+\n\s*renderAssistantExtras\(root\);/);
  assert.match(ai, /zakat:assistant-ui-command/);
  assert.match(app, /zakat:assistant-ui-command/);
  assert.match(ai, /لا ينفذ المساعد التغيير دون تأكيد/);
  assert.match(ai, /DELETE-RECORD/);
  assert.match(ai, /confirmation/);
});

test("assistant conversation is a concise accessible live workspace", async () => {
  const ai = await read("js/ai-assistant.js");

  assert.match(ai, /role="log" aria-live="polite" aria-relevant="additions text"/);
  assert.match(ai, /aria-label="اكتب رسالتك للمساعد" aria-controls="ai-chat-log"/);
  assert.match(ai, /data-ai-new-chat type="button"/);
  assert.match(ai, /const visiblePrompts = [^;]+\.slice\(0, 4\)/);
  assert.match(ai, /result\.suggestions\.slice\(0, 4\)/);
  assert.doesNotMatch(ai, /result\.suggestions\.slice\(0, 5\)/);
  assert.match(ai, /assistantState\.suggestions = \[\]/);
  assert.match(ai, /menuSections/);
  assert.doesNotMatch(ai, /السياق: \$\{escapeHtml\(assistantState\.currentScreen\)\}/);
});
