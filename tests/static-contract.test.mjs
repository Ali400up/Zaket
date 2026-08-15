import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sql = await readFile(join(root, "supabase/database_complete.sql"), "utf8");
const app = await readFile(join(root, "js/app.js"), "utf8");
const service = await readFile(join(root, "js/data-service.js"), "utf8");
const edge = await readFile(join(root, "supabase/functions/gemini-assistant/index.ts"), "utf8");
const config = await readFile(join(root, "js/config.js"), "utf8");
const screens = await readFile(join(root, "js/screen-config.js"), "utf8");

test("single SQL install file has balanced transaction and dollar delimiters", async () => {
  const sqlFiles = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.name.endsWith(".sql")) sqlFiles.push(path);
    }
  }
  await walk(join(root, "supabase"));
  assert.equal(sqlFiles.length, 1, sqlFiles.join("\n"));
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0);
  assert.equal((sql.match(/^BEGIN;$/gmi) || []).length, (sql.match(/^COMMIT;$/gmi) || []).length);
  assert.match(sql.trimEnd(), /UPDATE public\.system_installation SET version='12\.0\.0'[\s\S]*COMMIT;$/);
});

test("database contains every requested reliability contract", () => {
  assert.match(sql, /ALTER COLUMN transfer_no SET DEFAULT[\s\S]*cash_transfer_seq/);
  assert.match(sql, /setval\('public\.cash_transfer_seq'[\s\S]*UPDATE public\.cash_transfers/);
  assert.match(sql, /cash_transfers_insert_finance_v12[\s\S]*'admin','supervisor','accountant'[\s\S]*status='draft'/);
  assert.match(sql, /cashbox_ledger_read_scoped_v12[\s\S]*current_delegate_id/);
  assert.match(sql, /campaign_distributors_read_own_v12[\s\S]*delegate_id=public\.current_delegate_id/);
  assert.match(sql, /can_create_beneficiaries boolean NOT NULL DEFAULT false/i);
  assert.match(sql, /enforce_distributor_beneficiary_submission/);
  assert.match(sql, /CREATE FUNCTION public\.reopen_campaign_distributor/);
  assert.match(sql, /settled_return_amount=v_remaining/);
  assert.match(sql, /لا يمكن إعادة الفتح لأن مبلغ التسوية أُعيد تخصيصه/);
  assert.match(sql, /settled_return_amount=settled_return_amount\+payment\.amount/);
  assert.match(sql, /CREATE FUNCTION public\.create_application_backup/);
  assert.match(sql, /CREATE FUNCTION public\.restore_application_backup/);
  assert.match(sql, /'cash_transfers','cash_payments','cashbox_ledger'/);
  assert.match(sql, /digest\(\(p_backup->'tables'\)::text,'sha256'\)/);
  assert.match(sql, /PERFORM public\.assert_financial_integrity\(\)/);
  assert.match(sql, /CREATE FUNCTION public\.financial_integrity_report/);
  assert.match(sql, /posted_receipt_ledger/);
  assert.match(sql, /posted_campaign_funding_ledger/);
  assert.match(sql, /cancelled_transfer_net_zero/);
  assert.match(sql, /ledger_currency_matches_cashbox/);
  assert.match(sql, /posted_payment_currency_matches_campaign/);
  assert.match(sql, /protect_financial_document_trigger/);
  assert.match(sql, /protect_campaign_distributor_state_trigger/);
  assert.match(sql, /protect_authorized_device_state_trigger/);
  assert.match(sql, /authorized_devices_status_active_check/);
  assert.match(sql, /enforce_no_final_offline_trigger/);
  assert.match(sql, /CREATE FUNCTION public\.retry_failed_operation/);
});

test("UI scopes distributor creation and uses explicit status transitions", () => {
  assert.match(app, /profile\.can_create_beneficiaries === true/);
  assert.match(app, /payload\.delegate_id = state\.session\.profile\.delegate_id/);
  assert.match(app, /field\.key === "delegate_id"\) && role === "distributor"/);
  assert.match(app, /\["beneficiaries", "campaign_distributors", "authorized_devices"\]/);
  assert.match(app, /fa-toggle-on/);
  assert.match(app, /fa-toggle-off/);
  assert.match(service, /reopen_campaign_distributor/);
  assert.match(service, /set_authorized_device_status/);
  assert.match(service, /createApplicationBackup/);
  assert.match(app, /action === "retry"/);
  assert.match(service, /retry_failed_operation/);
  assert.match(service, /allow_offline_drafts === false/);
  assert.match(app, /name="allow_final_offline" type="checkbox" disabled/);
  assert.match(screens, /الحالة \(من أزرار الإجراء\)[\s\S]*lockForAll: true/);
  assert.match(screens, /الحالة \(من زر التشغيل\/الإيقاف\)[\s\S]*lockForAll:true/);
});

test("every frontend data view exists in the single database file", () => {
  const mapBlock = service.match(/const viewMap = \{([\s\S]*?)\n\};/)?.[1] || "";
  const views = [...mapBlock.matchAll(/:\s*"([^"]+)"/g)].map(match => match[1]);
  assert.ok(views.length > 20);
  for (const view of views) assert.match(sql.toLowerCase(), new RegExp(`view public\\.${view.toLowerCase()}`), view);
});

test("every frontend RPC exists and is present in the final grant section", () => {
  const names = new Set([...service.matchAll(/\.rpc\("([a-z0-9_]+)"/g)].map(match => match[1]));
  for (const match of service.matchAll(/:\s*"((?:post|cancel|confirm|settle|reopen|save|retry)_[a-z0-9_]+)"/g)) names.add(match[1]);
  const finalGrant = sql.slice(sql.lastIndexOf("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public"));
  for (const name of names) {
    assert.match(sql, new RegExp(`(?:CREATE|REPLACE)\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "i"), `missing ${name}`);
    assert.ok(finalGrant.includes(`public.${name}(`), `not granted in final section: ${name}`);
  }
});

test("Gemini stays server-side and mutations require confirmation", () => {
  assert.doesNotMatch(config, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
  assert.match(edge, /GEMINI_API_KEY/);
  assert.match(edge, /get_system_guide/);
  assert.match(edge, /confirm_action/);
  assert.match(edge, /status: "pending"/);
  assert.match(edge, /idempotency_key/);
  assert.match(edge, /auth\.getUser/);
  assert.match(edge, /x-device-fingerprint/);
  assert.match(edge, /عملة الصندوق المصدر/);
  assert.match(edge, /رصيد الصندوق «\$\{from\.name\}» غير كافٍ/);
  assert.match(edge, /caller\.from\("v_cashboxes"\)/);
  assert.match(edge, /السجل المطلوب غير موجود أو خارج نطاق صلاحيتك/);
  assert.match(edge, /delegate: \["full_name", "delegate_type", "phone"\]/);
  assert.doesNotMatch(edge, /execute\s+sql|raw_sql|arbitrary_sql/i);
});
