import { demoData } from "./demo-data.js";
import { supabase, isSupabaseConfigured, getCurrentSession, getCurrentProfile } from "./supabase-client.js";
import { queueOperation, syncOfflineQueue } from "./offline.js";
import { isOnline } from "./connectivity.js";
import { getDeviceFingerprint, getDeviceName } from "./device-identity.js";
import { nextBeneficiaryStatus, nextCampaignDistributorStatus, nextDeviceStatus, settleAllocation, reopenAllocation, cancelPaymentAgainstAllocation, validateCashTransfer } from "./state-machines.js";

const DB_KEY = "zakat_demo_database_v12";
const SESSION_KEY = "zakat_demo_session_v12";
const config = window.ZAKAT_CONFIG || {};
const LIVE_CACHE_KEY = "zakat_live_cache_v12";
const LEGACY_LIVE_CACHE_KEYS = ["zakat_live_cache_v11_2", "zakat_live_cache_v11_2_1"];
const OFFLINE_SESSION_KEY = "zakat_offline_session_v12";
const USER_SESSION_KEY = "zakat_active_user_session_v12";
const CACHE_TABLES = new Set(["profiles","branches","delegates","beneficiaries","beneficiary_categories","health_conditions","campaigns","campaign_distributors","cashboxes","cashbox_users","items","warehouses","stock_balances","system_settings"]);
const DISTRIBUTOR_SCOPED_TABLES = new Set(["beneficiaries", "cash_payments", "in_kind_payments", "distribution_assignments"]);

function readLiveCache() {
  try { return JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || "{}"); } catch { return {}; }
}
function readStoredSession() {
  try {
    const key = isSupabaseConfigured ? OFFLINE_SESSION_KEY : SESSION_KEY;
    const session = JSON.parse(localStorage.getItem(key) || "null");
    if (!session?.profile?.id) return null;
    if (isSupabaseConfigured && session.deviceFingerprint !== getDeviceFingerprint()) return null;
    return session;
  } catch { return null; }
}
function sessionProfileId(session) {
  return String(session?.profile?.id || session?.user?.id || "");
}
export function isCacheEntryOwnedBySession(entry, session, deviceFingerprint) {
  const ownerProfileId = sessionProfileId(session);
  return Boolean(
    entry &&
    ownerProfileId &&
    String(entry.ownerProfileId || "") === ownerProfileId &&
    entry.deviceFingerprint === deviceFingerprint
  );
}
function cacheRows(table, rows) {
  if (!CACHE_TABLES.has(table)) return;
  const session = readStoredSession();
  const ownerProfileId = sessionProfileId(session);
  if (!ownerProfileId) return;
  const cache = readLiveCache();
  cache[table] = {
    rows: clone(rows || []),
    savedAt: new Date().toISOString(),
    ownerProfileId,
    ownerRole: session.profile?.role || null,
    deviceFingerprint: getDeviceFingerprint()
  };
  localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(cache));
}
function cachedRows(table, session = readStoredSession()) {
  const entry = readLiveCache()[table];
  if (!isCacheEntryOwnedBySession(entry, session, getDeviceFingerprint())) return [];
  return Array.isArray(entry.rows) ? entry.rows : [];
}
async function refreshCachedSettings() {
  if (!supabase || !isOnline()) return;
  const { data, error } = await supabase.from("v_system_settings").select("*").eq("id", 1).maybeSingle();
  if (!error && data) cacheRows("system_settings", [data]);
}
const viewMap = {
  profiles: "v_profiles",
  delegates: "v_delegates",
  donors: "v_donors",
  beneficiary_categories: "v_beneficiary_categories",
  health_conditions: "v_health_conditions",
  beneficiaries: "v_beneficiaries",
  campaigns: "v_campaigns",
  campaign_funding: "v_campaign_funding",
  campaign_distributors: "v_campaign_distributors",
  campaign_in_kind_funding: "v_campaign_in_kind_funding",
  cashboxes: "v_cashboxes",
  cashbox_users: "v_cashbox_users",
  cash_receipts: "v_cash_receipts",
  cash_payments: "v_cash_payments",
  cash_transfers: "v_cash_transfers",
  distribution_assignments: "v_distribution_assignments",
  authorized_devices: "v_authorized_devices",
  login_attempts: "v_login_attempts",
  user_sessions: "v_user_sessions",
  user_archives: "v_user_archives",
  branches: "v_branches",
  wallet_providers: "v_wallet_providers",
  bulk_disbursements: "v_bulk_disbursements",
  disbursement_results: "v_disbursement_results",
  units: "v_units",
  items: "v_items_inventory",
  inventory_lots: "v_inventory_lots",
  warehouses: "v_warehouses",
  stock_balances: "v_stock_balances",
  in_kind_receipts: "v_in_kind_receipts",
  baskets: "v_baskets",
  in_kind_payments: "v_in_kind_payments",
  messages: "v_messages",
  message_templates: "v_message_templates",
  import_jobs: "v_import_jobs",
  account_closings: "v_account_closings",
  audit_logs: "v_audit_logs",
  system_settings: "v_system_settings"
};

const childTableMap = {
  in_kind_receipts: { table: "in_kind_receipt_details", foreignKey: "receipt_id" },
  campaign_in_kind_funding: { table: "campaign_in_kind_funding_details", foreignKey: "funding_id" },
  baskets: { table: "basket_items", foreignKey: "basket_id" },
  in_kind_payments: { table: "in_kind_payment_details", foreignKey: "payment_id" }
};

const idempotentTables = new Set([
  "cash_receipts", "cash_payments", "cash_transfers", "campaign_funding",
  "campaign_in_kind_funding", "in_kind_receipts", "in_kind_payments", "baskets"
]);

const atomicDraftRpcMap = {
  in_kind_receipts: "save_in_kind_receipt_draft",
  campaign_in_kind_funding: "save_campaign_in_kind_funding_draft",
  in_kind_payments: "save_in_kind_payment_draft",
  baskets: "save_basket_with_items"
};

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function nextBeneficiaryToggleStatus(currentStatus) {
  return nextBeneficiaryStatus(currentStatus);
}

export function scopeRowsForSession(table, rows, session, delegates = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (session?.profile?.role !== "distributor" || !DISTRIBUTOR_SCOPED_TABLES.has(table)) return safeRows;
  const profileId = sessionProfileId(session);
  const profileDelegateId = session?.profile?.delegate_id || null;
  const linkedDelegate = (delegates || []).find(delegate => delegate?.is_active !== false && (
    (profileId && String(delegate.profile_id || "") === profileId) ||
    (profileDelegateId && String(delegate.id) === String(profileDelegateId))
  ));
  if (!linkedDelegate) return [];
  return safeRows.filter(row => String(row.delegate_id || "") === String(linkedDelegate.id));
}

function ensureDemoDb() {
  if (!localStorage.getItem(DB_KEY)) localStorage.setItem(DB_KEY, JSON.stringify(demoData));
  return readDemoDb();
}

function readDemoDb() {
  try { return JSON.parse(localStorage.getItem(DB_KEY) || JSON.stringify(demoData)); }
  catch { return clone(demoData); }
}

function writeDemoDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  window.dispatchEvent(new CustomEvent("zakat:data-change"));
}

function uid(prefix = "rec") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nextNumber(records, prefix, key = "voucher_no") {
  const year = new Date().getFullYear();
  const numbers = records
    .map(row => String(row[key] || "").match(/(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}

function findById(db, table, id) {
  return (db[table] || []).find(row => String(row.id) === String(id));
}

function relationName(db, table, id, key = "name") {
  const row = findById(db, table, id);
  return row?.[key] || "-";
}

function demoProfileCapabilities(db, profile) {
  const delegate = (db.delegates || []).find(row => row.profile_id === profile?.id && row.is_active !== false);
  return {
    ...profile,
    delegate_id: delegate?.id || null,
    can_create_beneficiaries: delegate?.can_create_beneficiaries === true
  };
}

async function liveProfileCapabilities(profile) {
  const { data, error } = await supabase.rpc("get_my_capabilities");
  if (error) throw new Error(`تعذر تحميل صلاحيات الحساب: ${error.message}`);
  const capabilities = Array.isArray(data) ? data[0] : data;
  return { ...profile, ...(capabilities || {}) };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function statusIsPosted(row) {
  return row.status === "posted";
}

function enrichDemoRow(db, table, row) {
  const r = { ...row };
  switch (table) {
    case "delegates": {
      const allocations = (db.campaign_distributors || []).filter(x => x.delegate_id === r.id);
      r.cash_balance = allocations.reduce((total, x) => total + Number(x.allocated_amount || 0) - Number(x.spent_amount || 0) - Number(x.returned_amount || 0), 0);
      r.inventory_count = db.inventory_lots.filter(x => x.delegate_id === r.id).reduce((a, x) => a + Number(x.quantity_available || 0), 0);
      break;
    }
    case "donors":
      r.cash_total = sum(db.cash_receipts.filter(x => statusIsPosted(x) && x.donor_id === r.id), "amount");
      r.in_kind_total = db.in_kind_receipts.filter(x => statusIsPosted(x) && x.donor_id === r.id).length;
      break;
    case "beneficiaries":
      r.category_name = relationName(db, "beneficiary_categories", r.category_id);
      r.health_condition_name = relationName(db, "health_conditions", r.health_condition_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      break;
    case "campaigns": {
      const receipts = (db.campaign_funding || []).filter(x => statusIsPosted(x) && x.campaign_id === r.id);
      const payments = db.cash_payments.filter(x => statusIsPosted(x) && x.campaign_id === r.id);
      r.received_total = sum(receipts, "amount");
      r.spent_total = sum(payments, "amount");
      r.balance = r.received_total - r.spent_total;
      r.responsible_name = relationName(db, "profiles", r.responsible_id, "full_name");
      break;
    }
    case "cashboxes": {
      const ledger = (db.cashbox_ledger || []).filter(x => x.cashbox_id === r.id);
      r.branch_name = relationName(db, "branches", r.branch_id);
      r.current_balance = Number(r.opening_balance || 0) + sum(ledger, "credit") - sum(ledger, "debit");
      break;
    }
    case "campaign_funding": {
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.cashbox_name = relationName(db, "cashboxes", r.cashbox_id);
      r.created_by_name = relationName(db, "profiles", r.created_by, "full_name");
      break;
    }
    case "campaign_distributors": {
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      r.cashbox_name = relationName(db, "cashboxes", r.cashbox_id);
      r.remaining_amount = Number(r.allocated_amount || 0) - Number(r.spent_amount || 0) - Number(r.returned_amount || 0);
      break;
    }
    case "campaign_in_kind_funding": {
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.warehouse_name = relationName(db, "warehouses", r.warehouse_id);
      r.items_count = (r.details || []).length;
      r.total_quantity = sum(r.details || [], "quantity");
      r.items_summary = (r.details || []).map(x => `${relationName(db, "items", x.item_id)} × ${x.quantity}`).join("، ");
      break;
    }
    case "cash_transfers": {
      r.from_cashbox_name = relationName(db, "cashboxes", r.from_cashbox_id);
      r.to_cashbox_name = relationName(db, "cashboxes", r.to_cashbox_id);
      break;
    }
    case "cash_receipts": {
      r.donor_name = relationName(db, "donors", r.donor_id);
      r.cashbox_name = relationName(db, "cashboxes", r.cashbox_id);
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      const used = sum(db.cash_payments.filter(x => statusIsPosted(x) && x.cash_receipt_id === r.id), "amount");
      r.available_balance = statusIsPosted(r) ? Number(r.amount || 0) - used : 0;
      break;
    }
    case "cash_payments":
      r.cashbox_name = relationName(db, "cashboxes", r.cashbox_id);
      r.beneficiary_name = relationName(db, "beneficiaries", r.beneficiary_id, "full_name");
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      r.receipt_no = relationName(db, "cash_receipts", r.cash_receipt_id, "voucher_no");
      break;
    case "items": {
      const lots = db.inventory_lots.filter(x => x.item_id === r.id);
      r.available_qty = lots.reduce((a, x) => a + Number(x.quantity_available || 0), 0);
      r.damaged_qty = lots.reduce((a, x) => a + Number(x.quantity_damaged || 0), 0);
      const alertDate = new Date(Date.now() + 30 * 86400000);
      const expiring = lots.filter(x => x.expiry_date && new Date(x.expiry_date) <= alertDate && Number(x.quantity_available) > 0);
      r.expiry_alert = expiring.length ? `${expiring.length} تشغيلة قريبة` : "سليم";
      break;
    }
    case "in_kind_receipts":
      r.donor_name = relationName(db, "donors", r.donor_id);
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      r.items_count = r.details?.length || 0;
      r.valid_total = (r.details || []).reduce((a, x) => a + Number(x.valid_qty || 0), 0);
      break;
    case "baskets": {
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.items_count = r.details?.length || 0;
      const sets = (r.details || []).map(detail => {
        const item = enrichDemoRow(db, "items", findById(db, "items", detail.item_id) || {});
        return Number(detail.quantity || 0) > 0 ? Math.floor(Number(item.available_qty || 0) / Number(detail.quantity)) : 0;
      });
      r.available_sets = sets.length ? Math.min(...sets) : 0;
      break;
    }
    case "in_kind_payments":
      r.beneficiary_name = relationName(db, "beneficiaries", r.beneficiary_id, "full_name");
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      r.basket_name = relationName(db, "baskets", r.basket_id);
      r.items_count = r.details?.length || 0;
      break;
    case "account_closings":
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      break;
    case "audit_logs": {
      const user = findById(db, "profiles", r.user_id);
      r.user_name = user?.full_name || "النظام";
      r.user_role = user?.role || "system";
      break;
    }
  }
  return r;
}

function auditDemo(db, action, table, recordId, oldData, newData, result = "success") {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  db.audit_logs.unshift({
    id: uid("audit"),
    user_id: session?.profile?.id || "u-admin",
    action,
    table_name: table,
    record_id: recordId,
    old_data: oldData || null,
    new_data: newData || null,
    session_info: { device: navigator.userAgent.slice(0, 120) },
    result,
    created_at: new Date().toISOString()
  });
}

function validateDemoCreate(db, table, data, editingId = null) {
  const rows = db[table] || [];
  const duplicate = (key, message) => {
    if (!data[key]) return;
    const found = rows.find(row => row[key] && String(row[key]).toLowerCase() === String(data[key]).toLowerCase() && row.id !== editingId);
    if (found) throw new Error(message);
  };
  if (table === "profiles") duplicate("username", "اسم المستخدم مستخدم مسبقاً.");
  if (table === "donors") duplicate("identity_no", "يوجد متبرع بنفس رقم الهوية أو السجل.");
  if (table === "beneficiaries") duplicate("national_id", "رقم الهوية مسجل مسبقاً.");
  if (table === "items") duplicate("name", "الصنف موجود مسبقاً.");
  if (["beneficiary_categories", "health_conditions"].includes(table)) duplicate("name", "القيمة موجودة مسبقاً.");
  if (table === "campaigns" && data.start_date && data.end_date && data.end_date < data.start_date) throw new Error("تاريخ النهاية يسبق تاريخ البداية.");
  if (table === "campaign_distributors") {
    const campaignId = data.campaign_id || findById(db, table, editingId)?.campaign_id;
    const allocatedAmount = Number(data.allocated_amount ?? findById(db, table, editingId)?.allocated_amount ?? 0);
    const returnedAmount = Number(data.returned_amount ?? findById(db, table, editingId)?.returned_amount ?? 0);
    const spentAmount = Number(data.spent_amount ?? findById(db, table, editingId)?.spent_amount ?? 0);
    if (allocatedAmount < spentAmount + returnedAmount) throw new Error("المبلغ المخصص أقل من المصروف والمرتجع.");
    const funded = sum((db.campaign_funding || []).filter(x => x.campaign_id === campaignId && x.status === "posted"), "amount");
    const committed = (db.campaign_distributors || []).filter(x => x.campaign_id === campaignId && x.id !== editingId).reduce((total, x) => total + Number(x.allocated_amount || 0) - Number(x.returned_amount || 0), 0);
    if (committed + allocatedAmount - returnedAmount > funded) throw new Error("المبلغ المخصص يتجاوز الرصيد غير الموزع للحملة.");
  }
}

function generateIdentifiers(db, table, data) {
  const result = { ...data };
  if (table === "beneficiaries" && !result.file_no) result.file_no = `BEN-${String((db.beneficiaries.length || 0) + 1).padStart(5, "0")}`;
  if (table === "cash_receipts" && !result.voucher_no) result.voucher_no = nextNumber(db.cash_receipts, "CR");
  if (table === "cash_payments" && !result.voucher_no) result.voucher_no = nextNumber(db.cash_payments, "CP");
  if (table === "in_kind_receipts" && !result.voucher_no) result.voucher_no = nextNumber(db.in_kind_receipts, "IKR");
  if (table === "in_kind_payments" && !result.voucher_no) result.voucher_no = nextNumber(db.in_kind_payments, "IKP");
  if (table === "campaign_funding" && !result.funding_no) result.funding_no = nextNumber(db.campaign_funding || [], "CF", "funding_no");
  if (table === "campaign_in_kind_funding" && !result.funding_no) result.funding_no = nextNumber(db.campaign_in_kind_funding || [], "CIKF", "funding_no");
  if (table === "cash_transfers" && !result.transfer_no) result.transfer_no = nextNumber(db.cash_transfers || [], "CT", "transfer_no");
  if (table === "account_closings" && !result.closing_no) result.closing_no = nextNumber(db.account_closings, "CLS", "closing_no");
  return result;
}

function demoCashboxBalance(db, cashboxId) {
  const box = findById(db, "cashboxes", cashboxId);
  if (!box) return 0;
  const ledger = (db.cashbox_ledger || []).filter(x => x.cashbox_id === cashboxId);
  return Number(box.opening_balance || 0) + sum(ledger, "credit") - sum(ledger, "debit");
}

function buildDemoStockBalances(db) {
  const groups = new Map();
  for (const lot of db.inventory_lots || []) {
    if (!lot.warehouse_id || lot.campaign_id) continue;
    const key = `${lot.warehouse_id}|${lot.item_id}`;
    const current = groups.get(key) || { id: key, warehouse_id: lot.warehouse_id, item_id: lot.item_id, available_qty: 0, reserved_qty: 0, damaged_qty: 0 };
    current.available_qty += Number(lot.quantity_available || 0);
    current.damaged_qty += Number(lot.quantity_damaged || 0);
    groups.set(key, current);
  }
  return [...groups.values()].map(row => {
    const item = findById(db, "items", row.item_id) || {};
    return { ...row, warehouse_name: relationName(db, "warehouses", row.warehouse_id), item_name: item.name || "-", unit_name: item.unit || "-", min_stock: Number(item.min_stock || 0), status: row.available_qty <= Number(item.min_stock || 0) ? "review" : "active" };
  });
}

function addDemoLedger(db, entry) {
  db.cashbox_ledger = db.cashbox_ledger || [];
  const exists = db.cashbox_ledger.some(x => x.reference_table === entry.reference_table && x.reference_id === entry.reference_id && x.transaction_type === entry.transaction_type && x.cashbox_id === entry.cashbox_id);
  if (!exists) db.cashbox_ledger.unshift({ id: uid("led"), debit: 0, credit: 0, transaction_at: new Date().toISOString(), created_at: new Date().toISOString(), ...entry });
}

function demoPostCampaignFunding(db, id) {
  const record = findById(db, "campaign_funding", id);
  if (!record) throw new Error("تمويل الحملة غير موجود.");
  if (record.status === "posted") return record;
  if (record.status === "cancelled") throw new Error("لا يمكن ترحيل تمويل ملغي.");
  const campaign = findById(db, "campaigns", record.campaign_id);
  if (!campaign || campaign.status !== "open") throw new Error("يجب أن تكون الحملة مفتوحة.");
  const box = findById(db, "cashboxes", record.cashbox_id);
  if (!box || !box.is_active) throw new Error("الصندوق غير موجود أو موقوف.");
  if (box.currency !== record.currency) throw new Error("عملة التمويل لا تطابق عملة الصندوق.");
  if (demoCashboxBalance(db, record.cashbox_id) < Number(record.amount || 0)) throw new Error("رصيد الصندوق غير كافٍ.");
  addDemoLedger(db, { cashbox_id: record.cashbox_id, transaction_type: "campaign_funding", reference_table: "campaign_funding", reference_id: record.id, debit: Number(record.amount), currency: record.currency, description: `تمويل حملة - ${record.funding_no}` });
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoPostCashTransfer(db, id) {
  const record = findById(db, "cash_transfers", id);
  if (!record) throw new Error("التحويل غير موجود.");
  if (record.status === "posted") return record;
  if (record.status === "cancelled") throw new Error("لا يمكن ترحيل تحويل ملغي.");
  const from = findById(db, "cashboxes", record.from_cashbox_id);
  const to = findById(db, "cashboxes", record.to_cashbox_id);
  const available = demoCashboxBalance(db, record.from_cashbox_id);
  const checked = validateCashTransfer({ from: from ? { ...from, current_balance: available } : null, to, amount: record.amount });
  record.amount = checked.amount;
  record.currency = checked.currency;
  addDemoLedger(db, { cashbox_id: record.from_cashbox_id, transaction_type: "transfer_out", reference_table: "cash_transfers", reference_id: record.id, debit: Number(record.amount), currency: record.currency || "YER", description: `تحويل صادر - ${record.transfer_no}` });
  addDemoLedger(db, { cashbox_id: record.to_cashbox_id, transaction_type: "transfer_in", reference_table: "cash_transfers", reference_id: record.id, credit: Number(record.amount), currency: record.currency || "YER", description: `تحويل وارد - ${record.transfer_no}` });
  record.status = "posted"; record.posted_at = new Date().toISOString();
  return record;
}

function demoPostCashReceipt(db, id) {
  const record = findById(db, "cash_receipts", id);
  if (!record) throw new Error("سند القبض غير موجود.");
  if (record.status === "posted") return record;
  if (record.status === "cancelled") throw new Error("السند ملغي.");
  if (!record.cashbox_id) throw new Error("يجب تحديد الصندوق المستلم.");
  const box = findById(db, "cashboxes", record.cashbox_id);
  if (!box || !box.is_active) throw new Error("الصندوق غير موجود أو موقوف.");
  if (box.currency !== record.currency) throw new Error("عملة السند لا تطابق عملة الصندوق.");
  addDemoLedger(db, { cashbox_id: record.cashbox_id, transaction_type: "donation", reference_table: "cash_receipts", reference_id: record.id, credit: Number(record.amount), currency: record.currency, description: `سند قبض - ${record.voucher_no}` });
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoPostCashPayment(db, id) {
  const record = findById(db, "cash_payments", id);
  if (!record) throw new Error("سند الصرف غير موجود.");
  if (record.status === "posted") return record;
  if (record.status === "cancelled") throw new Error("السند ملغي.");
  const beneficiary = findById(db, "beneficiaries", record.beneficiary_id);
  const campaign = findById(db, "campaigns", record.campaign_id);
  const delegate = findById(db, "delegates", record.delegate_id);
  if (beneficiary?.status !== "approved") throw new Error("المستفيد غير معتمد.");
  if (campaign?.status !== "open" || !["cash", "mixed"].includes(campaign.campaign_type)) throw new Error("الحملة مغلقة أو لا تسمح بالصرف النقدي.");
  if (!delegate?.is_active) throw new Error("الموزع موقوف.");
  if (beneficiary.delegate_id && beneficiary.delegate_id !== delegate.id) throw new Error("المستفيد غير مربوط بالموزع المحدد.");
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  const settings = (db.system_settings || [])[0] || {};
  if (session?.profile?.role === "distributor" && settings.require_payment_approval !== false && record.status !== "approved") throw new Error("سند الموزع يحتاج اعتماد المشرف قبل الترحيل.");
  if (record.override_reason && session?.profile?.role !== "admin") throw new Error("الاستثناء من منع التكرار متاح لمدير النظام فقط.");
  const duplicate = db.cash_payments.find(x => x.id !== id && statusIsPosted(x) && x.beneficiary_id === record.beneficiary_id && x.campaign_id === record.campaign_id);
  if (duplicate && !record.override_reason) throw new Error("المستفيد استلم سابقاً من الحملة.");
  const amount = Number(record.amount || 0);
  if (!(amount > 0)) throw new Error("مبلغ الصرف يجب أن يكون أكبر من صفر.");
  const campaignReceipts = sum((db.campaign_funding || []).filter(x => statusIsPosted(x) && x.campaign_id === record.campaign_id), "amount");
  const campaignPayments = sum(db.cash_payments.filter(x => x.id !== id && statusIsPosted(x) && x.campaign_id === record.campaign_id), "amount");
  if (amount > campaignReceipts - campaignPayments) throw new Error(`رصيد الحملة غير كافٍ. المتاح ${campaignReceipts - campaignPayments}.`);
  const assignment = (db.campaign_distributors || []).find(x => x.campaign_id === record.campaign_id && x.delegate_id === record.delegate_id && x.status === "active");
  if (!assignment) throw new Error("الموزع غير مخصص لهذه الحملة.");
  const remaining = Number(assignment.allocated_amount || 0) - Number(assignment.spent_amount || 0) - Number(assignment.returned_amount || 0);
  if (amount > remaining) throw new Error(`رصيد الموزع المخصص من الحملة غير كافٍ. المتاح ${remaining}.`);
  assignment.spent_amount = Number(assignment.spent_amount || 0) + amount;
  if (Number(assignment.allocated_amount || 0) - assignment.spent_amount - Number(assignment.returned_amount || 0) <= 0) assignment.status = "settled";
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoPostInKindReceipt(db, id) {
  const record = findById(db, "in_kind_receipts", id);
  if (!record) throw new Error("سند القبض العيني غير موجود.");
  const warehouse = findById(db, "warehouses", record.warehouse_id);
  if (!warehouse || warehouse.is_active === false) throw new Error("المخزن المستلم غير موجود أو موقوف.");
  if (record.status === "posted") return record;
  for (const detail of record.details || []) {
    const total = Number(detail.quantity || 0);
    const qty = Number(detail.valid_qty || 0);
    const damaged = Number(detail.damaged_qty || 0);
    if (qty <= 0 || damaged < 0 || Math.abs(qty + damaged - total) > 0.0005) throw new Error("تفصيل الصنف غير متوازن: الكلية يجب أن تساوي الصالحة مع التالفة.");
    if (detail.expiry_date && new Date(detail.expiry_date) <= new Date()) throw new Error("لا يمكن ترحيل صنف منتهي الصلاحية.");
    db.inventory_lots.push({
      id: uid("lot"), item_id: detail.item_id, warehouse_id: record.warehouse_id, campaign_id: null, delegate_id: null,
      lot_no: detail.lot_no || null, expiry_date: detail.expiry_date || null,
      quantity_received: qty + damaged, quantity_damaged: damaged, quantity_available: qty, created_at: new Date().toISOString()
    });
  }
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoPostCampaignInKindFunding(db, id) {
  const record = findById(db, "campaign_in_kind_funding", id);
  if (!record) throw new Error("تمويل الحملة العيني غير موجود.");
  if (record.status === "posted") return record;
  const campaign = findById(db, "campaigns", record.campaign_id);
  if (!campaign || campaign.status !== "open") throw new Error("الحملة غير موجودة أو مغلقة.");
  if (!(record.details || []).length) throw new Error("أضف صنفاً واحداً على الأقل للتمويل العيني.");
  for (const detail of record.details) {
    let remaining = Number(detail.quantity || 0);
    const lots = (db.inventory_lots || []).filter(lot => lot.item_id === detail.item_id && lot.warehouse_id === record.warehouse_id && !lot.campaign_id && Number(lot.quantity_available || 0) > 0).sort((a,b) => String(a.expiry_date || "9999").localeCompare(String(b.expiry_date || "9999")));
    const available = sum(lots, "quantity_available");
    if (available < remaining) throw new Error(`الرصيد العام غير كافٍ للصنف ${relationName(db, "items", detail.item_id)}. المتاح ${available}.`);
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(lot.quantity_available || 0));
      lot.quantity_available -= take;
      db.inventory_lots.push({ id: uid("lot"), item_id: detail.item_id, warehouse_id: record.warehouse_id, campaign_id: record.campaign_id, delegate_id: null, source_funding_id: record.id, source_lot_id: lot.id, lot_no: lot.lot_no || null, expiry_date: lot.expiry_date || null, quantity_received: take, quantity_damaged: 0, quantity_available: take, created_at: new Date().toISOString() });
      remaining -= take;
    }
  }
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function getPaymentDetails(db, record) {
  if (record.distribution_type === "basket") {
    const basket = findById(db, "baskets", record.basket_id);
    if (!basket?.is_active) throw new Error("السلة غير نشطة.");
    return clone(basket.details || []);
  }
  return clone(record.details || []);
}

function allocateInventory(db, details, campaignId, delegateId, reverse = false) {
  for (const detail of details) {
    let remaining = Number(detail.quantity || 0);
    if (remaining <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر.");
    const lots = db.inventory_lots
      .filter(lot => lot.item_id === detail.item_id && (!campaignId || lot.campaign_id === campaignId) && Number(lot.quantity_available || 0) > 0)
      .sort((a, b) => String(a.expiry_date || "9999").localeCompare(String(b.expiry_date || "9999")));
    if (reverse) {
      const target = lots[0] || db.inventory_lots.find(lot => lot.item_id === detail.item_id && lot.campaign_id === campaignId);
      if (target) target.quantity_available = Number(target.quantity_available || 0) + remaining;
      continue;
    }
    const available = lots.reduce((a, lot) => a + Number(lot.quantity_available || 0), 0);
    if (available < remaining) {
      const item = findById(db, "items", detail.item_id);
      throw new Error(`المخزون غير كافٍ للصنف: ${item?.name || detail.item_id}. المتاح ${available}.`);
    }
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(lot.quantity_available));
      lot.quantity_available -= take;
      remaining -= take;
    }
  }
}

function demoPostInKindPayment(db, id) {
  const record = findById(db, "in_kind_payments", id);
  if (!record) throw new Error("سند الصرف العيني غير موجود.");
  const beneficiary = findById(db, "beneficiaries", record.beneficiary_id);
  const campaign = findById(db, "campaigns", record.campaign_id);
  if (beneficiary?.status !== "approved") throw new Error("المستفيد غير معتمد.");
  if (campaign?.status !== "open") throw new Error("الحملة مغلقة.");
  const duplicate = db.in_kind_payments.find(x => x.id !== id && statusIsPosted(x) && x.beneficiary_id === record.beneficiary_id && x.campaign_id === record.campaign_id && (!record.basket_id || x.basket_id === record.basket_id));
  if (duplicate && !record.override_reason) throw new Error("المستفيد استلم السلة سابقاً.");
  if (record.status === "posted") return record;
  const details = getPaymentDetails(db, record);
  allocateInventory(db, details, record.campaign_id, record.delegate_id, false);
  record.details = details;
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoCancel(db, table, id, reason = "إلغاء بواسطة المستخدم") {
  const record = findById(db, table, id);
  if (!record) throw new Error("السجل غير موجود.");
  if (record.status === "cancelled") return record;
  if (table === "cash_receipts" && record.status === "posted") {
    const linked = db.cash_payments.some(x => statusIsPosted(x) && x.cash_receipt_id === id);
    if (linked) throw new Error("لا يمكن إلغاء سند قبض مستخدم في الصرف.");
    if (demoCashboxBalance(db, record.cashbox_id) < Number(record.amount || 0)) throw new Error("لا يمكن عكس سند القبض لأن الرصيد الحالي أقل من قيمته.");
    addDemoLedger(db, { cashbox_id: record.cashbox_id, transaction_type: "refund", reference_table: "cash_receipts", reference_id: record.id, debit: Number(record.amount), currency: record.currency, description: `عكس سند قبض - ${record.voucher_no}` });
  }
  if (table === "campaign_funding" && record.status === "posted") {
    const operational = sum((db.campaign_funding || []).filter(x => x.campaign_id === record.campaign_id && statusIsPosted(x)), "amount") - sum((db.cash_payments || []).filter(x => x.campaign_id === record.campaign_id && statusIsPosted(x)), "amount");
    if (operational < Number(record.amount || 0)) throw new Error("لا يمكن الإلغاء لأن جزءاً من هذا التمويل صُرف بالفعل.");
    const otherFunding = sum((db.campaign_funding || []).filter(x => x.id !== record.id && x.campaign_id === record.campaign_id && statusIsPosted(x)), "amount");
    const committed = (db.campaign_distributors || []).filter(x => x.campaign_id === record.campaign_id).reduce((total, x) => total + Number(x.allocated_amount || 0) - Number(x.returned_amount || 0), 0);
    if (otherFunding < committed) throw new Error("لا يمكن الإلغاء قبل تخفيض أو تسوية تخصيصات الموزعين.");
    addDemoLedger(db, { cashbox_id: record.cashbox_id, transaction_type: "refund", reference_table: "campaign_funding", reference_id: record.id, credit: Number(record.amount), currency: record.currency, description: `عكس تمويل حملة - ${record.funding_no}` });
  }
  if (table === "cash_payments" && record.status === "posted") {
    const assignment = (db.campaign_distributors || []).find(x => x.campaign_id === record.campaign_id && x.delegate_id === record.delegate_id);
    if (assignment) {
      Object.assign(assignment, cancelPaymentAgainstAllocation(assignment, record.amount));
    }
  }
  if (table === "cash_transfers" && record.status === "posted") {
    if (demoCashboxBalance(db, record.to_cashbox_id) < Number(record.amount || 0)) throw new Error("لا يمكن عكس التحويل لأن رصيد الصندوق الهدف غير كافٍ.");
    addDemoLedger(db, { cashbox_id: record.to_cashbox_id, transaction_type: "refund", reference_table: "cash_transfers", reference_id: record.id, debit: Number(record.amount), currency: record.currency, description: `عكس تحويل وارد - ${record.transfer_no}` });
    addDemoLedger(db, { cashbox_id: record.from_cashbox_id, transaction_type: "refund", reference_table: "cash_transfers", reference_id: record.id, credit: Number(record.amount), currency: record.currency, description: `عكس تحويل صادر - ${record.transfer_no}` });
  }
  if (table === "campaign_in_kind_funding" && record.status === "posted") {
    const targets = (db.inventory_lots || []).filter(lot => lot.source_funding_id === record.id);
    for (const target of targets) {
      if (Number(target.quantity_available || 0) < Number(target.quantity_received || 0)) throw new Error("لا يمكن إلغاء التمويل لأن جزءاً من مخزون الحملة صُرف.");
    }
    for (const target of targets) {
      const source = findById(db, "inventory_lots", target.source_lot_id);
      if (source) source.quantity_available = Number(source.quantity_available || 0) + Number(target.quantity_received || 0);
      target.quantity_available = 0;
    }
  }
  if (table === "in_kind_payments" && record.status === "posted") allocateInventory(db, record.details || [], record.campaign_id, record.delegate_id, true);
  if (table === "cash_payments") {
    (db.distribution_assignments || [])
      .filter(item => item.payment_id === record.id)
      .forEach(item => { item.delivery_status = "cancelled"; item.delivered_at = null; });
  }
  record.status = "cancelled";
  record.cancellation_reason = reason;
  record.cancelled_at = new Date().toISOString();
  return record;
}

async function executeQueuedOperation(item) {
  if (!supabase) return;
  const payload = { ...item.payload };
  const details = payload.details;
  delete payload.details;
  if (idempotentTables.has(item.table)) payload.idempotency_key = payload.idempotency_key || item.idempotencyKey;

  const atomicRpc = atomicDraftRpcMap[item.table];
  if (atomicRpc && Array.isArray(details)) {
    const { error } = await supabase.rpc(atomicRpc, {
      p_record: payload,
      p_details: details,
      p_id: item.operation === "update" ? item.recordId : null
    });
    if (error) throw error;
    return;
  }

  if (item.operation === "create") {
    const { data: inserted, error } = await supabase.from(item.table).insert(payload).select("id").single();
    if (error) {
      if (error.code === "23505") return;
      throw error;
    }
    const child = childTableMap[item.table];
    if (inserted?.id && child && Array.isArray(details) && details.length) {
      const childRows = details.map(detail => {
        const copy = { ...detail, [child.foreignKey]: inserted.id };
        delete copy.id;
        return copy;
      });
      const { error: childError } = await supabase.from(child.table).insert(childRows);
      if (childError) throw childError;
    }
  } else if (item.operation === "update") {
    const { error } = await supabase.from(item.table).update(payload).eq("id", item.recordId);
    if (error) throw error;
    const child = childTableMap[item.table];
    if (child && Array.isArray(details)) {
      const { error: deleteError } = await supabase.from(child.table).delete().eq(child.foreignKey, item.recordId);
      if (deleteError) throw deleteError;
      if (details.length) {
        const childRows = details.map(detail => {
          const copy = { ...detail, [child.foreignKey]: item.recordId };
          delete copy.id;
          return copy;
        });
        const { error: childError } = await supabase.from(child.table).insert(childRows);
        if (childError) throw childError;
      }
    }
  }
}

export const dataService = {
  get demoMode() { return !isSupabaseConfigured; },

  async initialize() {
    LEGACY_LIVE_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
    if (!isSupabaseConfigured) ensureDemoDb();
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("/service-worker.js"); } catch { /* optional */ }
    }
    window.addEventListener("online", () => { if ((localStorage.getItem("zakat_sync_mode") || "automatic") === "automatic") this.syncQueue(); });
    return true;
  },

  async signIn(identifier, password, remember = true) {
    const phone = String(identifier || "").replace(/[^0-9+]/g, "");
    if (!phone || password.length < 6) throw new Error("تعذر تسجيل الدخول. تحقق من البيانات أو الاتصال ثم حاول مجدداً.");
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const storedProfile = db.profiles.find(p => String(p.phone || "").replace(/[^0-9+]/g, "") === phone) || db.profiles[0];
      const profile = demoProfileCapabilities(db, storedProfile);
      if (!profile?.is_active) throw new Error("تعذر تسجيل الدخول. راجع مدير النظام.");
      const session = { user: { id: profile.id, phone: profile.phone }, profile, demo: true, expiresAt: remember ? null : Date.now() + 8 * 3600000 };
      db.user_sessions = db.user_sessions || [];
      const tracked = { id: uid("us"), user_id: profile.id, user_name: profile.full_name, role_name: profile.role, device_name: getDeviceName(), branch_name: relationName(db, "branches", profile.branch_id), login_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), status: "active" };
      db.user_sessions.unshift(tracked);
      localStorage.setItem(USER_SESSION_KEY, tracked.id);
      db.login_attempts = db.login_attempts || [];
      db.login_attempts.unshift({ id: uid("la"), attempted_at: new Date().toISOString(), phone, device_name: getDeviceName(), ip_address: "محلي", result: "success", lockout_until: null });
      writeDemoDb(db);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    }
    // لا نستخدم مزود الهاتف أو SMS. رقم الهاتف يتحول داخلياً إلى بريد تقني غير ظاهر.
    const digits = phone.replace(/\D/g, "").replace(/^967/, "").replace(/^0+/, "");
    if (!/^7\d{8}$/.test(digits)) throw new Error("أدخل رقم هاتف يمني صحيحاً من 9 أرقام، مثل 777123456.");
    const email = `u${digits}@zakat.local`;
    const fp = getDeviceFingerprint();
    const dname = getDeviceName();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      try { await supabase.rpc("record_login_attempt", { p_phone: digits, p_fingerprint: fp, p_device_name: dname, p_result: "failed" }); } catch {}
      throw new Error("رقم الهاتف أو كلمة المرور غير صحيحة.");
    }
    const { data: deviceRows, error: deviceError } = await supabase.rpc("request_device_authorization", { p_fingerprint: fp, p_device_name: dname, p_platform: navigator.platform || "Web" });
    if (deviceError) { await supabase.auth.signOut(); throw new Error(`تعذر التحقق من ترخيص الجهاز: ${deviceError.message}`); }
    const device = Array.isArray(deviceRows) ? deviceRows[0] : deviceRows;
    if (device?.status !== "approved") {
      try { await supabase.rpc("record_login_attempt", { p_phone: digits, p_fingerprint: fp, p_device_name: dname, p_result: device?.status === "blocked" ? "blocked" : "pending_device" }); } catch {}
      await supabase.auth.signOut();
      throw new Error(device?.status === "blocked" ? "هذا الجهاز محظور. راجع مدير النظام." : "تم تسجيل طلب الجهاز، لكنه لم يُعتمد بعد. اطلب من المدير الموافقة عليه.");
    }
    const profile = await liveProfileCapabilities(await getCurrentProfile(data.user.id));
    if (!profile?.is_active) { await supabase.auth.signOut(); throw new Error("تعذر تسجيل الدخول. راجع مدير النظام."); }
    try { await supabase.rpc("record_login_attempt", { p_phone: digits, p_fingerprint: fp, p_device_name: dname, p_result: "success" }); } catch {}
    const { data: openedSession } = await supabase.rpc("open_user_session", { p_fingerprint: fp, p_device_name: dname });
    if (openedSession) localStorage.setItem(USER_SESSION_KEY, String(openedSession));
    const result = { ...data.session, profile };
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({ user: { id: data.user.id }, profile, deviceFingerprint: fp, cachedAt: new Date().toISOString() }));
    await refreshCachedSettings();
    return result;
  },

  async signOut() {
    const sessionId = localStorage.getItem(USER_SESSION_KEY);
    try {
      if (!isSupabaseConfigured) {
        const db = ensureDemoDb();
        const tracked = findById(db, "user_sessions", sessionId);
        if (tracked) { tracked.status = "inactive"; tracked.last_activity_at = new Date().toISOString(); writeDemoDb(db); }
      } else {
        if (sessionId) { try { await supabase.rpc("close_user_session", { p_session_id: sessionId }); } catch {} }
        await supabase.auth.signOut();
      }
    } finally {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(USER_SESSION_KEY);
      localStorage.removeItem(OFFLINE_SESSION_KEY);
      localStorage.removeItem(LIVE_CACHE_KEY);
    }
  },

  async getSession() {
    if (!isSupabaseConfigured) {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (session?.expiresAt && session.expiresAt < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
      return session;
    }
    if (!isOnline()) {
      try {
        const cached = JSON.parse(localStorage.getItem(OFFLINE_SESSION_KEY) || "null");
        return cached?.deviceFingerprint === getDeviceFingerprint() ? cached : null;
      } catch { return null; }
    }
    try {
      const session = await getCurrentSession();
      if (!session) {
        localStorage.removeItem(OFFLINE_SESSION_KEY);
        localStorage.removeItem(LIVE_CACHE_KEY);
        return null;
      }
      const profile = await liveProfileCapabilities(await getCurrentProfile(session.user.id));
      const result = { ...session, profile };
      localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({ user: { id: session.user.id }, profile, deviceFingerprint: getDeviceFingerprint(), cachedAt: new Date().toISOString() }));
      await refreshCachedSettings();
      return result;
    } catch {
      if (isOnline()) return null;
      try {
        const cached = JSON.parse(localStorage.getItem(OFFLINE_SESSION_KEY) || "null");
        return cached?.deviceFingerprint === getDeviceFingerprint() ? cached : null;
      } catch { return null; }
    }
  },

  async touchSession() {
    const sessionId = localStorage.getItem(USER_SESSION_KEY);
    if (!sessionId) return false;
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const tracked = findById(db, "user_sessions", sessionId);
      if (!tracked || tracked.status !== "active") return false;
      tracked.last_activity_at = new Date().toISOString();
      writeDemoDb(db);
      return true;
    }
    if (!isOnline()) return false;
    const { error } = await supabase.rpc("touch_user_session", { p_session_id: sessionId });
    if (error) throw error;
    return true;
  },

  async list(table, options = {}) {
    const { search = "", filters = {}, page = 1, pageSize = 500, orderBy = null, ascending = false, dateKey = null, dateFrom = "", dateTo = "" } = options;
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const sourceRows = table === "stock_balances" ? buildDemoStockBalances(db) : (db[table] || []);
      let rows = scopeRowsForSession(table, sourceRows.map(row => enrichDemoRow(db, table, row)), readStoredSession(), db.delegates || []);
      Object.entries(filters || {}).forEach(([key, value]) => {
        if (value !== "" && value !== undefined && value !== null) rows = rows.filter(row => String(row[key]) === String(value));
      });
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(q));
      }
      if (dateKey && dateFrom) rows = rows.filter(row => String(row[dateKey] || "") >= dateFrom);
      if (dateKey && dateTo) {
        const upperDate = dateKey.endsWith("_at") ? `${dateTo}T23:59:59.999` : dateTo;
        rows = rows.filter(row => String(row[dateKey] || "") <= upperDate);
      }
      rows.sort((a, b) => {
        const av = a[orderBy] ?? "";
        const bv = b[orderBy] ?? "";
        return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
      const total = rows.length;
      const from = (page - 1) * pageSize;
      return { data: rows.slice(from, from + pageSize), total };
    }

    let query = supabase.from(viewMap[table] || table).select("*", { count: "exact" });
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== "" && value !== undefined && value !== null) query = query.eq(key, value);
    });
    if (dateKey && dateFrom) query = query.gte(dateKey, dateFrom);
    if (dateKey && dateTo) query = query.lte(dateKey, dateKey.endsWith("_at") ? `${dateTo}T23:59:59.999` : dateTo);
    if (search) query = query.or(`search_text.ilike.%${search.replaceAll(",", " ")}%`);
    if (orderBy) query = query.order(orderBy, { ascending, nullsFirst: false });
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
    try {
      const { data, error, count } = await query;
      if (error) throw error;
      cacheRows(table, data || []);
      return { data: data || [], total: count || 0, source: "network" };
    } catch (error) {
      const session = readStoredSession();
      const rows = scopeRowsForSession(table, cachedRows(table, session), session, cachedRows("delegates", session));
      if (rows.length || !isOnline()) {
        let filtered = rows;
        Object.entries(filters || {}).forEach(([key, value]) => { if (value !== "" && value != null) filtered = filtered.filter(row => String(row[key]) === String(value)); });
        if (search) { const q = search.toLowerCase(); filtered = filtered.filter(row => JSON.stringify(row).toLowerCase().includes(q)); }
        const fromCache = filtered.slice((page-1)*pageSize, (page-1)*pageSize+pageSize);
        return { data: fromCache, total: filtered.length, source: "cache", cachedAt: readLiveCache()[table]?.savedAt || null };
      }
      throw error;
    }
  },

  async get(table, id) {
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const row = findById(db, table, id);
      return row ? enrichDemoRow(db, table, row) : null;
    }
    const { data, error } = await supabase.from(table).select("*").eq("id", id).single();
    if (error) throw error;
    if (childTableMap[table]) {
      const child = childTableMap[table];
      const { data: details, error: childError } = await supabase.from(child.table).select("*").eq(child.foreignKey, id);
      if (childError) throw childError;
      data.details = details || [];
    }
    return data;
  },

  async create(table, payload) {
    const data = { ...payload };
    delete data.password;
    const postableTables = ["cash_receipts", "cash_payments", "cash_transfers", "campaign_funding", "campaign_in_kind_funding", "in_kind_receipts", "in_kind_payments"];
    const settings = cachedRows("system_settings")[0] || {};
    const shouldAutoPost = postableTables.includes(table) && settings.auto_post_all_operations === true;
    // Always insert as a draft/open record first. Final posting must go through the
    // database RPC so balance, permissions and ledger checks are never bypassed.
    if (postableTables.includes(table)) data.status = "draft";
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (table === "beneficiaries" && session?.profile?.role === "distributor") {
        const delegate = (db.delegates || []).find(row => row.profile_id === session.profile.id && row.is_active !== false);
        if (!delegate?.can_create_beneficiaries) throw new Error("لم يمنحك مدير النظام صلاحية إضافة مستفيدين جدد.");
        data.delegate_id = delegate.id;
        data.status = "under_review";
        data.approved_by = null;
        data.approved_at = null;
      }
      if (table === "cash_payments") {
        const context = await this.getPaymentContext(data.beneficiary_id, data.campaign_id, data.delegate_id || null);
        Object.assign(data, { delegate_id: context.delegate_id, cashbox_id: context.cashbox_id, currency: context.currency });
      }
      if (table === "in_kind_payments") {
        const beneficiary = findById(db, "beneficiaries", data.beneficiary_id);
        if (!beneficiary || beneficiary.status !== "approved") throw new Error("المستفيد غير موجود أو غير معتمد.");
        if (session?.profile?.role !== "admin" && data.delegate_id && data.delegate_id !== beneficiary.delegate_id) throw new Error("لا يستطيع تغيير موزع المستفيد إلا مدير النظام.");
        data.delegate_id = session?.profile?.role === "admin" && data.delegate_id ? data.delegate_id : beneficiary.delegate_id;
        if (data.override_reason && session?.profile?.role !== "admin") throw new Error("الاستثناء من منع التكرار متاح لمدير النظام فقط.");
      }
      validateDemoCreate(db, table, data);
      const row = generateIdentifiers(db, table, { id: uid(table.slice(0, 3)), ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (table === "account_closings") {
        const campaign = enrichDemoRow(db, "campaigns", findById(db, "campaigns", row.campaign_id));
        const pending = [...db.cash_receipts, ...db.cash_payments, ...db.in_kind_receipts, ...db.in_kind_payments].some(x => x.campaign_id === row.campaign_id && !["posted", "cancelled"].includes(x.status));
        if (pending) throw new Error("توجد سندات غير مرحلة.");
        if (row.closing_type === "full" && Number(campaign.balance || 0) !== 0) throw new Error("يوجد رصيد غير موزع؛ لا يمكن الإقفال الكامل.");
        Object.assign(row, { total_received: campaign.received_total, total_spent: campaign.spent_total, balance: campaign.balance, status: "closed", closed_at: new Date().toISOString() });
        const campaignRaw = findById(db, "campaigns", row.campaign_id);
        if (row.closing_type === "full") campaignRaw.status = "closed";
      }
      db[table] = db[table] || [];
      db[table].unshift(row);
      auditDemo(db, `إضافة ${table}`, table, row.id, null, row);
      writeDemoDb(db);
      return enrichDemoRow(db, table, row);
    }

    if (table === "profiles") {
      const { data: fnData, error } = await supabase.functions.invoke(config.edgeFunctions?.createUser || "create-user", { body: payload, headers: { "x-device-fingerprint": getDeviceFingerprint() } });
      if (error) throw error;
      return fnData;
    }

    const details = data.details;
    delete data.details;
    if (idempotentTables.has(table)) data.idempotency_key = data.idempotency_key || crypto.randomUUID();
    try {
      const atomicRpc = atomicDraftRpcMap[table];
      if (atomicRpc && Array.isArray(details)) {
        const { data: savedId, error } = await supabase.rpc(atomicRpc, {
          p_record: data,
          p_details: details,
          p_id: null
        });
        if (error) throw error;
        if (shouldAutoPost) return await this.action(table, savedId, "post");
        return await this.get(table, savedId);
      }
      const { data: inserted, error } = await supabase.from(table).insert(data).select().single();
      if (error) throw error;
      if (details?.length && childTableMap[table]) {
        const child = childTableMap[table];
        const rows = details.map(detail => ({ ...detail, [child.foreignKey]: inserted.id }));
        const { error: childError } = await supabase.from(child.table).insert(rows);
        if (childError) {
          await supabase.from(table).delete().eq("id", inserted.id);
          throw new Error(`فشل حفظ تفاصيل السجل وتم التراجع عن السجل الرئيسي: ${childError.message}`);
        }
      }
      if (shouldAutoPost) return await this.action(table, inserted.id, "post");
      return inserted;
    } catch (error) {
      if (!isOnline() || /fetch|network/i.test(error.message || "")) {
        if (settings.allow_offline_drafts === false) throw new Error("حفظ المسودات دون اتصال معطل من إعدادات النظام.");
        queueOperation({ operation: "create", table, payload: { ...data, ...(details ? { details } : {}) }, idempotencyKey: data.idempotency_key });
        return { ...data, ...(details ? { details } : {}), id: `local-${crypto.randomUUID()}`, _queued: true };
      }
      throw error;
    }
  },

  async update(table, id, payload) {
    const data = { ...payload };
    delete data.password;
    const settings = cachedRows("system_settings")[0] || {};
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (table === "beneficiaries" && session?.profile?.role === "distributor") throw new Error("لا يستطيع الموزع تعديل ملف المستفيد بعد إرساله للمراجعة.");
      const row = findById(db, table, id);
      if (!row) throw new Error("السجل غير موجود.");
      validateDemoCreate(db, table, data, id);
      const old = clone(row);
      Object.assign(row, data, { updated_at: new Date().toISOString() });
      auditDemo(db, `تعديل ${table}`, table, id, old, row);
      writeDemoDb(db);
      return enrichDemoRow(db, table, row);
    }

    const details = data.details;
    delete data.details;
    try {
      if (table === "system_settings") {
        const { data: updatedSettings, error: settingsError } = await supabase.rpc("save_system_settings", { p_settings: data });
        if (settingsError) throw settingsError;
        cacheRows("system_settings", [updatedSettings]);
        return updatedSettings;
      }
      const atomicRpc = atomicDraftRpcMap[table];
      if (atomicRpc && Array.isArray(details)) {
        const { data: savedId, error } = await supabase.rpc(atomicRpc, {
          p_record: data,
          p_details: details,
          p_id: id
        });
        if (error) throw error;
        return await this.get(table, savedId);
      }
      const { data: updated, error } = await supabase.from(table).update(data).eq("id", id).select().single();
      if (error) throw error;
      if (details && childTableMap[table]) {
        const child = childTableMap[table];
        const { error: deleteError } = await supabase.from(child.table).delete().eq(child.foreignKey, id);
        if (deleteError) throw deleteError;
        if (details.length) {
          const rows = details.map(detail => {
            const copy = { ...detail, [child.foreignKey]: id };
            delete copy.id;
            return copy;
          });
          const { error: insertError } = await supabase.from(child.table).insert(rows);
          if (insertError) throw insertError;
        }
      }
      return updated;
    } catch (error) {
      if (!isOnline() || /fetch|network/i.test(error.message || "")) {
        if (settings.allow_offline_drafts === false) throw new Error("حفظ المسودات دون اتصال معطل من إعدادات النظام.");
        queueOperation({ operation: "update", table, recordId: id, payload: { ...data, ...(details ? { details } : {}) } });
        return { ...data, ...(details ? { details } : {}), id, _queued: true };
      }
      throw error;
    }
  },

  async action(table, id, action, extra = {}) {
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const record = findById(db, table, id);
      if (!record) throw new Error("السجل غير موجود.");
      const old = clone(record);
      let result = record;
      if (action === "post") {
        if (table === "cash_receipts") result = demoPostCashReceipt(db, id);
        else if (table === "campaign_funding") result = demoPostCampaignFunding(db, id);
        else if (table === "cash_transfers") result = demoPostCashTransfer(db, id);
        else if (table === "cash_payments") result = demoPostCashPayment(db, id);
        else if (table === "in_kind_receipts") result = demoPostInKindReceipt(db, id);
        else if (table === "campaign_in_kind_funding") result = demoPostCampaignInKindFunding(db, id);
        else if (table === "in_kind_payments") result = demoPostInKindPayment(db, id);
      } else if (action === "cancel") result = demoCancel(db, table, id, extra.reason);
      else if (action === "approve") record.status = "approved";
      else if (action === "confirm-receipt") record.receipt_status = "received";
      else if (action === "settle" && table === "campaign_distributors") {
        const settled = settleAllocation(record);
        Object.assign(record, settled);
        record.settled_at = new Date().toISOString();
      }
      else if (action === "toggle") {
        if (table === "beneficiaries") record.status = nextBeneficiaryToggleStatus(record.status);
        else if (table === "campaign_distributors") record.status = nextCampaignDistributorStatus(record.status);
        else if (table === "authorized_devices") {
          record.status = nextDeviceStatus(record.status);
          record.is_active = record.status === "approved";
        }
        else record.is_active = !record.is_active;
      }
      else if (action === "open-close") record.status = record.status === "open" ? "closed" : "open";
      else if (action === "reopen") {
        if (table === "campaign_distributors") {
          const funded = sum((db.campaign_funding || []).filter(x => x.campaign_id === record.campaign_id && statusIsPosted(x)), "amount");
          const committed = (db.campaign_distributors || []).filter(x => x.campaign_id === record.campaign_id)
            .reduce((total, row) => total + Number(row.allocated_amount || 0) - Number(row.returned_amount || 0), 0);
          Object.assign(record, reopenAllocation(record, funded - committed));
        } else {
          record.status = "reopened";
          const campaign = findById(db, "campaigns", record.campaign_id);
          if (campaign) campaign.status = "open";
        }
      }
      else if (action === "retry" && table === "disbursement_results") {
        if (record.result !== "failed") throw new Error("يمكن إعادة محاولة النتيجة الفاشلة فقط.");
        record.result = "pending";
        record.error_message = null;
        record.provider_reference = null;
        record.processed_at = null;
      }
      else if (action === "retry" && table === "messages") {
        if (record.status !== "failed") throw new Error("يمكن إعادة محاولة الرسالة الفاشلة فقط.");
        record.status = "queued";
        record.provider_reference = null;
        record.sent_at = null;
      }
      record.updated_at = new Date().toISOString();
      auditDemo(db, `${action} ${table}`, table, id, old, record);
      writeDemoDb(db);
      return enrichDemoRow(db, table, result);
    }

    const rpcMap = {
      "cash_receipts:post": "post_cash_receipt",
      "campaign_funding:post": "post_campaign_funding",
      "cash_transfers:post": "post_cash_transfer",
      "cash_payments:post": "post_cash_payment",
      "in_kind_receipts:post": "post_in_kind_receipt",
      "campaign_in_kind_funding:post": "post_campaign_in_kind_funding",
      "in_kind_payments:post": "post_in_kind_payment",
      "cash_receipts:cancel": "cancel_cash_receipt",
      "campaign_funding:cancel": "cancel_campaign_funding",
      "cash_transfers:cancel": "cancel_cash_transfer",
      "cash_payments:cancel": "cancel_cash_payment",
      "in_kind_receipts:cancel": "cancel_in_kind_receipt",
      "campaign_in_kind_funding:cancel": "cancel_campaign_in_kind_funding",
      "in_kind_payments:cancel": "cancel_in_kind_payment",
      "cash_payments:confirm-receipt": "confirm_cash_payment_receipt",
      "in_kind_payments:confirm-receipt": "confirm_in_kind_payment_receipt",
      "campaign_distributors:settle": "settle_campaign_distributor",
      "campaign_distributors:reopen": "reopen_campaign_distributor",
      "account_closings:reopen": "reopen_account_closing"
    };
    const rpc = rpcMap[`${table}:${action}`];
    if (rpc) {
      const argNames = {
        post_cash_receipt: "p_id",
        post_campaign_funding: "p_funding_id",
        post_campaign_in_kind_funding: "p_id",
        post_cash_transfer: "p_transfer_id"
      };
      const args = { [argNames[rpc] || "p_id"]: id };
      if (extra.reason) args.p_reason = extra.reason;
      if (action === "cancel" && !args.p_reason) args.p_reason = "إلغاء من واجهة النظام";
      if (action === "reopen" && !args.p_reason) args.p_reason = "إعادة فتح من واجهة النظام";
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      return data;
    }
    if (action === "toggle" && table === "authorized_devices") {
      const status = extra.current === "approved" ? "blocked" : "approved";
      const { data, error } = await supabase.rpc("set_authorized_device_status", { p_id: id, p_status: status });
      if (error) throw error;
      return data;
    }
    if (action === "toggle" && table === "campaign_distributors") {
      const status = extra.current === "active" ? "suspended" : "active";
      const { data, error } = await supabase.rpc("set_campaign_distributor_status", { p_id: id, p_status: status });
      if (error) throw error;
      return data;
    }
    if (action === "retry" && ["disbursement_results", "messages"].includes(table)) {
      const { data, error } = await supabase.rpc("retry_failed_operation", { p_table: table, p_id: id });
      if (error) throw error;
      return data;
    }
    const patch = action === "approve" ? { status: "approved" }
      : action === "confirm-receipt" ? { receipt_status: "received" }
      : action === "toggle" && table === "beneficiaries" ? { status: nextBeneficiaryToggleStatus(extra.current) }
      : action === "toggle" ? { is_active: extra.current === false }
      : action === "open-close" ? { status: extra.current === "open" ? "closed" : "open" }
      : {};
    let updateQuery = supabase.from(table).update(patch).eq("id", id);
    if (action === "toggle" && table === "beneficiaries") updateQuery = updateQuery.eq("status", extra.current);
    const { data, error } = await updateQuery.select().single();
    if (error) throw error;
    return data;
  },


  async getPaymentContext(beneficiaryId, campaignId = null, requestedDelegateId = null) {
    if (!beneficiaryId) throw new Error("اختر مستفيداً معتمداً.");
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      const role = session?.profile?.role || "data_entry";
      if (!["admin", "supervisor", "accountant", "distributor"].includes(role)) throw new Error("غير مصرح بالصرف النقدي.");
      const beneficiary = findById(db, "beneficiaries", beneficiaryId);
      if (!beneficiary || beneficiary.status !== "approved") throw new Error("المستفيد غير موجود أو غير معتمد.");
      if (role !== "admin" && requestedDelegateId && requestedDelegateId !== beneficiary.delegate_id) throw new Error("لا يستطيع تغيير موزع المستفيد إلا مدير النظام.");
      const effectiveDelegateId = role === "admin" && requestedDelegateId ? requestedDelegateId : beneficiary.delegate_id;
      const delegate = findById(db, "delegates", effectiveDelegateId);
      if (!delegate || delegate.is_active === false) throw new Error("المستفيد غير مربوط بموزع نشط.");
      if (role === "distributor" && delegate.profile_id !== session.profile.id) throw new Error("المستفيد غير مرتبط بحساب الموزع الحالي.");
      const assignments = (db.campaign_distributors || [])
        .filter(x => x.delegate_id === delegate.id && x.status === "active" && (!campaignId || x.campaign_id === campaignId))
        .map(x => ({ assignment: x, campaign: findById(db, "campaigns", x.campaign_id), cashbox: findById(db, "cashboxes", x.cashbox_id) }))
        .filter(x => x.campaign?.status === "open" && ["cash", "mixed"].includes(x.campaign?.campaign_type) && x.cashbox?.is_active !== false && x.cashbox?.currency === x.campaign?.currency)
        .map(x => {
          const allocationRemaining = Number(x.assignment.allocated_amount || 0) - Number(x.assignment.spent_amount || 0) - Number(x.assignment.returned_amount || 0);
          const campaignFunded = sum((db.campaign_funding || []).filter(f => f.campaign_id === x.campaign.id && f.status === "posted"), "amount");
          const campaignSpent = sum((db.cash_payments || []).filter(p => p.campaign_id === x.campaign.id && p.status === "posted"), "amount");
          return { ...x, available: Math.max(0, Math.min(allocationRemaining, campaignFunded - campaignSpent)) };
        })
        .filter(x => x.available > 0);
      if (!assignments.length) throw new Error("لا يوجد تخصيص حملة نشط للموزع المسؤول عن هذا المستفيد.");
      const selected = assignments.sort((a,b) => String(b.assignment.assigned_at || "").localeCompare(String(a.assignment.assigned_at || "")))[0];
      return { beneficiary_id: beneficiary.id, delegate_id: delegate.id, delegate_name: delegate.full_name, campaign_id: selected.campaign.id, campaign_name: selected.campaign.name, cashbox_id: selected.cashbox.id, cashbox_name: selected.cashbox.name, currency: selected.cashbox.currency, available_amount: selected.available, assignment_id: selected.assignment.id };
    }
    const { data, error } = await supabase.rpc("get_cash_payment_context", {
      p_beneficiary_id: beneficiaryId,
      p_campaign_id: campaignId || null,
      p_delegate_id: requestedDelegateId || null
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("لا يوجد تخصيص صالح لهذا المستفيد.");
    return row;
  },

  async getQuickDeliveryContext(beneficiaryId, requestedDelegateId = null) {
    return this.getPaymentContext(beneficiaryId, null, requestedDelegateId);
  },

  async quickDelivery(payload) {
    if (!payload?.beneficiary_id || !(Number(payload.amount) > 0)) throw new Error("اختر مستفيداً وأدخل مبلغاً صحيحاً.");
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      const context = await this.getPaymentContext(payload.beneficiary_id, payload.campaign_id || null, payload.delegate_id || null);
      if (Number(payload.amount) > Number(context.available_amount)) throw new Error(`المبلغ يتجاوز المتاح ${context.available_amount}.`);
      const duplicate = (db.cash_payments || []).find(x => x.status === "posted" && x.beneficiary_id === payload.beneficiary_id && x.campaign_id === context.campaign_id);
      if (duplicate) throw new Error("المستفيد استلم سابقاً من هذه الحملة.");
      const beneficiary = findById(db, "beneficiaries", payload.beneficiary_id);
      const row = { id: uid("cp"), voucher_no: nextNumber(db.cash_payments || [], "CP"), payment_date: new Date().toISOString().slice(0,10), delegate_id: context.delegate_id, beneficiary_id: beneficiary.id, campaign_id: context.campaign_id, cashbox_id: context.cashbox_id, amount: Number(payload.amount), currency: context.currency, delivery_method: "cash", receipt_status: "received", actual_recipient: beneficiary.full_name, status: "posted", posted_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), notes: "تسليم سريع" };
      db.cash_payments.unshift(row);
      const assignment = findById(db, "campaign_distributors", context.assignment_id);
      assignment.spent_amount = Number(assignment.spent_amount || 0) + row.amount;
      if (Number(assignment.allocated_amount || 0) - Number(assignment.spent_amount || 0) - Number(assignment.returned_amount || 0) <= 0) assignment.status = "settled";
      db.distribution_assignments = db.distribution_assignments || [];
      db.distribution_assignments.unshift({ id: uid("das"), beneficiary_id: beneficiary.id, delegate_id: context.delegate_id, campaign_id: context.campaign_id, amount: row.amount, delivery_status: "received", delivered_at: new Date().toISOString(), payment_id: row.id });
      auditDemo(db, "تسليم سريع نقدي", "cash_payments", row.id, null, row);
      writeDemoDb(db);
      return row;
    }
    const { data, error } = await supabase.rpc("quick_deliver_cash", {
      p_beneficiary_id: payload.beneficiary_id,
      p_amount: Number(payload.amount),
      p_campaign_id: payload.campaign_id,
      p_cashbox_id: payload.cashbox_id,
      p_delegate_id: payload.delegate_id || null
    });
    if (error) throw error;
    return data;
  },

  async bulkImport(table, rows, fileName = "import.xlsx") {
    if (!Array.isArray(rows) || !rows.length) throw new Error("لا توجد صفوف صالحة للاستيراد.");
    if (rows.length > 2000) throw new Error("الحد الأقصى للعملية الواحدة 2000 صف.");
    let success = 0;
    const errors = [];
    for (let index = 0; index < rows.length; index++) {
      try { await this.create(table, rows[index]); success += 1; }
      catch (error) { errors.push({ row: index + 2, message: error.message || "خطأ غير معروف" }); }
    }
    const job = { target_table: table, target_name: table, file_name: fileName, total_rows: rows.length, success_rows: success, error_rows: errors.length, errors, status: errors.length ? "partial" : "completed", created_at: new Date().toISOString() };
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      db.import_jobs = db.import_jobs || [];
      db.import_jobs.unshift({ id: uid("imp"), ...job });
      auditDemo(db, "استيراد Excel", table, null, null, { file_name: fileName, success, failed: errors.length });
      writeDemoDb(db);
    } else {
      const { error } = await supabase.from("import_jobs").insert({ target_table: table, file_name: fileName, total_rows: rows.length, success_rows: success, error_rows: errors.length, errors, status: job.status });
      if (error) console.warn("تعذر حفظ سجل الاستيراد", error);
    }
    return { success, failed: errors.length, errors };
  },

  async restoreBackup(backup) {
    if (!backup || typeof backup !== "object" || !backup.tables) throw new Error("النسخة لا تحتوي بيانات صالحة.");
    if (!isSupabaseConfigured) {
      if (!Array.isArray(backup.tables.profiles) || !Array.isArray(backup.tables.system_settings)) throw new Error("النسخة لا تحتوي الجداول الأساسية المطلوبة.");
      const restored = clone(backup.tables);
      restored.system_settings.forEach(row => { row.allow_final_offline = false; });
      writeDemoDb(restored);
      return { restored: true, mode: "demo-replace" };
    }
    if (!["zakat-backup-v1", "zakat-backup-v2"].includes(backup.format)) throw new Error("صيغة النسخة غير مدعومة.");
    if (backup.format === "zakat-backup-v2" && !backup.checksum) throw new Error("نسخة V2 لا تحتوي بصمة تحقق.");
    const confirmation = backup.format === "zakat-backup-v1" ? "LEGACY-V1-RESTORE" : String(backup.checksum).slice(0, 12);
    const { data, error } = await supabase.rpc("restore_application_backup", { p_backup: backup, p_confirmation: confirmation });
    if (error) throw new Error(`فشلت الاستعادة وتم التراجع عن كل التغييرات: ${error.message}`);
    localStorage.removeItem(LIVE_CACHE_KEY);
    return data;
  },

  async createApplicationBackup() {
    if (!isSupabaseConfigured) {
      const tables = clone(ensureDemoDb());
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(tables)));
      const checksum = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
      return {
        format: "zakat-backup-v2",
        version: config.version || "12.0.0",
        exported_at: new Date().toISOString(),
        mode: "demo-replace",
        tables,
        counts: Object.fromEntries(Object.entries(tables).filter(([, rows]) => Array.isArray(rows)).map(([table, rows]) => [table, rows.length])),
        checksum
      };
    }
    const { data, error } = await supabase.rpc("create_application_backup");
    if (error) throw new Error(`تعذر إنشاء النسخة الاحتياطية: ${error.message}`);
    return data;
  },

  async exportAllTables() {
    return (await this.createApplicationBackup()).tables;
  },

  async assistantRequest(action, payload = {}) {
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      if (action === "history") return { conversation_id: "demo", messages: [] };
      if (action === "chat") {
        const query = String(payload.message || "");
        const approved = (db.beneficiaries || []).filter(row => row.status === "approved").length;
        const openCampaigns = (db.campaigns || []).filter(row => row.status === "open").length;
        return { conversation_id: "demo", message: `وضع العرض المحلي: يوجد ${approved} مستفيدين معتمدين و${openCampaigns} حملات مفتوحة. سؤالك: ${query}` };
      }
      throw new Error("تنفيذ إجراءات المساعد يتطلب اتصال Supabase الحي.");
    }
    const { data, error } = await supabase.functions.invoke(config.edgeFunctions?.geminiAssistant || "gemini-assistant", {
      body: { action, ...payload },
      headers: { "x-device-fingerprint": getDeviceFingerprint() }
    });
    if (error) {
      let message = error.message || "تعذر تنفيذ طلب المساعد الذكي.";
      try {
        const details = await error.context?.json();
        message = details?.error || message;
        if (details?.request_id) message += ` (مرجع الطلب: ${details.request_id})`;
      } catch { /* response body unavailable */ }
      throw new Error(message);
    }
    if (data?.error) throw new Error(`${data.error}${data.request_id ? ` (مرجع الطلب: ${data.request_id})` : ""}`);
    return data;
  },

  async uploadFile(file, folder = "general") {
    if (!(file instanceof File)) return null;
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) throw new Error("حجم المرفق يجب ألا يتجاوز 5 ميجابايت.");
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (file.type && !allowed.includes(file.type)) throw new Error("نوع المرفق غير مدعوم. استخدم صورة أو PDF.");
    if (!isSupabaseConfigured) return `demo-files/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;

    const session = await getCurrentSession();
    if (!session?.user?.id) throw new Error("انتهت الجلسة، سجّل الدخول مجدداً.");
    const extension = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const safeFolder = String(folder || "general").replace(/[^A-Za-z0-9_-]/g, "_");
    const path = `${session.user.id}/${safeFolder}/${crypto.randomUUID()}.${extension || "bin"}`;
    const { error } = await supabase.storage.from("zakat-attachments").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
    });
    if (error) throw error;
    return path;
  },

  async resetUserPassword(id, password) {
    if (!isSupabaseConfigured) return { ok: true };
    const { data, error } = await supabase.functions.invoke(config.edgeFunctions?.resetUserPassword || "reset-user-password", { body: { user_id: id, password }, headers: { "x-device-fingerprint": getDeviceFingerprint() } });
    if (error) throw error;
    return data;
  },

  async syncQueue() {
    if (!isSupabaseConfigured) return { synced: 0, failed: 0 };
    return syncOfflineQueue(executeQueuedOperation);
  },

  async resetDemo() {
    localStorage.setItem(DB_KEY, JSON.stringify(demoData));
    window.dispatchEvent(new CustomEvent("zakat:data-change"));
  },

  exportDemoData() {
    return readDemoDb();
  }
};
