import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("assistant has a role-filtered system knowledge source and constrained action registry", async () => {
  const sql = await read("supabase/database_complete.sql");
  const edge = await read("supabase/functions/gemini-assistant/index.ts");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.system_knowledge_articles/);
  assert.match(sql, /search_system_knowledge/);
  assert.match(sql, /record-actions/);
  assert.match(sql, /article\.how_to::text,article\.rules::text/);
  assert.match(sql, /regexp_split_to_table\(input\.term/);
  assert.match(sql, /system_knowledge_articles_enable_rls/);
  assert.match(edge, /ACTION_REGISTRY/);
  assert.match(edge, /delegate: new Set\(\["admin", "supervisor", "accountant"\]\)/);
  assert.match(edge, /campaign: new Set\(\["admin", "supervisor", "accountant"\]\)/);
  assert.match(edge, /allowedFields/);
  assert.match(edge, /propose_mutation/);
  assert.match(edge, /idempotency_key/);
  assert.match(edge, /gemini-3\.7-flash/);
  assert.match(edge, /"x-goog-api-key": apiKey/);
  assert.doesNotMatch(edge, /generateContent\?key=/);
  assert.match(edge, /AbortController/);
  assert.match(edge, /const geminiDeadline = Date\.now\(\) \+ 45000/);
  assert.match(edge, /Math\.min\(12000, Math\.max\(1000, deadlineAt - Date\.now\(\) - 1000\)\)/);
  assert.match(edge, /attempt < 2/);
  assert.match(edge, /target_status/);
  assert.match(edge, /staleLease/);
  assert.match(edge, /fieldsMatch/);
  assert.match(edge, /record_id: operation === "create" \? crypto\.randomUUID\(\)/);
  assert.match(edge, /current_delegate_can_create_beneficiaries/);
  assert.match(edge, /const effective = \{ \.\.\.\(current \|\| \{\}\), \.\.\.fields \}/);
  assert.match(edge, /تاريخ نهاية كشف الحساب يسبق تاريخ البداية/);
  assert.match(edge, /تاريخ بداية كشف الحساب غير صالح/);
  assert.match(edge, /تاريخ نهاية كشف الحساب غير صالح/);
  assert.match(edge, /إجراء واحد في كل رسالة/);
  assert.doesNotMatch(edge, /execute_sql/);
});

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
});
