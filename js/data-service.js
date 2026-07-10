import { demoData } from "./demo-data.js";
import { supabase, isSupabaseConfigured, getCurrentSession, getCurrentProfile } from "./supabase-client.js";
import { queueOperation, syncOfflineQueue } from "./offline.js";

const DB_KEY = "zakat_demo_database_v1";
const SESSION_KEY = "zakat_demo_session_v1";
const config = window.ZAKAT_CONFIG || {};

const viewMap = {
  profiles: "v_profiles",
  delegates: "v_delegates",
  donors: "v_donors",
  beneficiary_categories: "v_beneficiary_categories",
  health_conditions: "v_health_conditions",
  beneficiaries: "v_beneficiaries",
  campaigns: "v_campaigns",
  cash_receipts: "v_cash_receipts",
  cash_payments: "v_cash_payments",
  items: "v_items_inventory",
  inventory_lots: "v_inventory_lots",
  in_kind_receipts: "v_in_kind_receipts",
  baskets: "v_baskets",
  in_kind_payments: "v_in_kind_payments",
  account_closings: "v_account_closings",
  audit_logs: "v_audit_logs",
  system_settings: "system_settings"
};

const childTableMap = {
  in_kind_receipts: { table: "in_kind_receipt_details", foreignKey: "receipt_id" },
  baskets: { table: "basket_items", foreignKey: "basket_id" },
  in_kind_payments: { table: "in_kind_payment_details", foreignKey: "payment_id" }
};

const idempotentTables = new Set(["cash_receipts", "cash_payments", "in_kind_receipts", "in_kind_payments"]);

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
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
      const receipts = db.cash_receipts.filter(x => statusIsPosted(x) && x.delegate_id === r.id);
      const payments = db.cash_payments.filter(x => statusIsPosted(x) && x.delegate_id === r.id);
      r.cash_balance = sum(receipts, "amount") - sum(payments, "amount");
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
      const receipts = db.cash_receipts.filter(x => statusIsPosted(x) && x.campaign_id === r.id);
      const payments = db.cash_payments.filter(x => statusIsPosted(x) && x.campaign_id === r.id);
      r.received_total = sum(receipts, "amount");
      r.spent_total = sum(payments, "amount");
      r.balance = r.received_total - r.spent_total;
      r.responsible_name = relationName(db, "profiles", r.responsible_id, "full_name");
      break;
    }
    case "cash_receipts": {
      r.donor_name = relationName(db, "donors", r.donor_id);
      r.campaign_name = relationName(db, "campaigns", r.campaign_id);
      r.delegate_name = relationName(db, "delegates", r.delegate_id, "full_name");
      const used = sum(db.cash_payments.filter(x => statusIsPosted(x) && x.cash_receipt_id === r.id), "amount");
      r.available_balance = statusIsPosted(r) ? Number(r.amount || 0) - used : 0;
      break;
    }
    case "cash_payments":
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
}

function generateIdentifiers(db, table, data) {
  const result = { ...data };
  if (table === "beneficiaries" && !result.file_no) result.file_no = `BEN-${String((db.beneficiaries.length || 0) + 1).padStart(5, "0")}`;
  if (table === "cash_receipts" && !result.voucher_no) result.voucher_no = nextNumber(db.cash_receipts, "CR");
  if (table === "cash_payments" && !result.voucher_no) result.voucher_no = nextNumber(db.cash_payments, "CP");
  if (table === "in_kind_receipts" && !result.voucher_no) result.voucher_no = nextNumber(db.in_kind_receipts, "IKR");
  if (table === "in_kind_payments" && !result.voucher_no) result.voucher_no = nextNumber(db.in_kind_payments, "IKP");
  if (table === "account_closings" && !result.closing_no) result.closing_no = nextNumber(db.account_closings, "CLS", "closing_no");
  return result;
}

function demoPostCashReceipt(db, id) {
  const record = findById(db, "cash_receipts", id);
  if (!record) throw new Error("سند القبض غير موجود.");
  const campaign = findById(db, "campaigns", record.campaign_id);
  const delegate = findById(db, "delegates", record.delegate_id);
  if (campaign?.status !== "open") throw new Error("لا يمكن القبض على حملة غير مفتوحة.");
  if (!delegate?.is_active) throw new Error("الموزع موقوف.");
  const currentTotal = sum(db.cash_receipts.filter(x => statusIsPosted(x) && x.campaign_id === record.campaign_id && x.id !== id), "amount");
  if (Number(campaign.ceiling || 0) > 0 && currentTotal + Number(record.amount) > Number(campaign.ceiling)) throw new Error("المبلغ يتجاوز سقف الحملة.");
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoPostCashPayment(db, id) {
  const record = findById(db, "cash_payments", id);
  if (!record) throw new Error("سند الصرف غير موجود.");
  const beneficiary = findById(db, "beneficiaries", record.beneficiary_id);
  const campaign = findById(db, "campaigns", record.campaign_id);
  const delegate = findById(db, "delegates", record.delegate_id);
  const receipt = findById(db, "cash_receipts", record.cash_receipt_id);
  if (beneficiary?.status !== "approved") throw new Error("المستفيد غير معتمد.");
  if (campaign?.status !== "open") throw new Error("الحملة مغلقة.");
  if (!delegate?.is_active) throw new Error("الموزع موقوف.");
  if (receipt?.status !== "posted") throw new Error("سند القبض غير مرحّل.");
  const duplicate = db.cash_payments.find(x => x.id !== id && statusIsPosted(x) && x.beneficiary_id === record.beneficiary_id && x.campaign_id === record.campaign_id);
  if (duplicate && !record.override_reason) throw new Error("المستفيد استلم سابقاً من الحملة.");
  const amount = Number(record.amount || 0);
  const receiptUsed = sum(db.cash_payments.filter(x => x.id !== id && statusIsPosted(x) && x.cash_receipt_id === record.cash_receipt_id), "amount");
  if (amount > Number(receipt.amount) - receiptUsed) throw new Error("سند القبض لا يحتوي رصيداً كافياً.");
  const campaignReceipts = sum(db.cash_receipts.filter(x => statusIsPosted(x) && x.campaign_id === record.campaign_id), "amount");
  const campaignPayments = sum(db.cash_payments.filter(x => x.id !== id && statusIsPosted(x) && x.campaign_id === record.campaign_id), "amount");
  if (amount > campaignReceipts - campaignPayments) throw new Error("رصيد الحملة غير كافٍ.");
  const delegateReceipts = sum(db.cash_receipts.filter(x => statusIsPosted(x) && x.delegate_id === record.delegate_id), "amount");
  const delegatePayments = sum(db.cash_payments.filter(x => x.id !== id && statusIsPosted(x) && x.delegate_id === record.delegate_id), "amount");
  if (amount > delegateReceipts - delegatePayments) throw new Error("رصيد الموزع غير كافٍ.");
  record.status = "posted";
  record.posted_at = new Date().toISOString();
  return record;
}

function demoPostInKindReceipt(db, id) {
  const record = findById(db, "in_kind_receipts", id);
  if (!record) throw new Error("سند القبض العيني غير موجود.");
  const campaign = findById(db, "campaigns", record.campaign_id);
  if (campaign?.status !== "open") throw new Error("الحملة مغلقة.");
  if (record.status === "posted") return record;
  for (const detail of record.details || []) {
    const qty = Number(detail.valid_qty || 0);
    const damaged = Number(detail.damaged_qty || 0);
    if (qty <= 0) throw new Error("الكمية الصالحة يجب أن تكون أكبر من صفر.");
    if (detail.expiry_date && new Date(detail.expiry_date) <= new Date()) throw new Error("لا يمكن ترحيل صنف منتهي الصلاحية.");
    db.inventory_lots.push({
      id: uid("lot"), item_id: detail.item_id, campaign_id: record.campaign_id, delegate_id: record.delegate_id,
      lot_no: detail.lot_no || null, expiry_date: detail.expiry_date || null,
      quantity_received: qty + damaged, quantity_damaged: damaged, quantity_available: qty, created_at: new Date().toISOString()
    });
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
  }
  if (table === "in_kind_payments" && record.status === "posted") allocateInventory(db, record.details || [], record.campaign_id, record.delegate_id, true);
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
    if (!isSupabaseConfigured) ensureDemoDb();
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("/service-worker.js"); } catch { /* optional */ }
    }
    window.addEventListener("online", () => this.syncQueue());
    return true;
  },

  async signIn(identifier, password, remember = true) {
    if (!isSupabaseConfigured) {
      if (!identifier || password.length < 6) throw new Error("أدخل بيانات صحيحة، وكلمة مرور من 6 أحرف على الأقل.");
      const db = ensureDemoDb();
      const profile = db.profiles.find(p => p.email === identifier || p.username === identifier) || db.profiles[0];
      if (!profile.is_active) throw new Error("الحساب موقوف، يرجى مراجعة الإدارة.");
      const session = { user: { id: profile.id, email: profile.email }, profile, demo: true, expiresAt: remember ? null : Date.now() + 8 * 3600000 };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    }

    let email = identifier;
    if (!identifier.includes("@")) {
      const { data, error } = await supabase.rpc("resolve_username", { p_username: identifier });
      if (error || !data) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
      email = data;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
    const profile = await getCurrentProfile(data.user.id);
    if (!profile?.is_active) {
      await supabase.auth.signOut();
      throw new Error("الحساب موقوف، يرجى مراجعة الإدارة.");
    }
    return { ...data.session, profile };
  },

  async signOut() {
    if (!isSupabaseConfigured) localStorage.removeItem(SESSION_KEY);
    else await supabase.auth.signOut();
  },

  async getSession() {
    if (!isSupabaseConfigured) {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (session?.expiresAt && session.expiresAt < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
      return session;
    }
    const session = await getCurrentSession();
    if (!session) return null;
    const profile = await getCurrentProfile(session.user.id);
    return { ...session, profile };
  },

  async list(table, options = {}) {
    const { search = "", filters = {}, page = 1, pageSize = 500, orderBy = "created_at", ascending = false } = options;
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
      let rows = (db[table] || []).map(row => enrichDemoRow(db, table, row));
      Object.entries(filters || {}).forEach(([key, value]) => {
        if (value !== "" && value !== undefined && value !== null) rows = rows.filter(row => String(row[key]) === String(value));
      });
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(q));
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
    if (search) query = query.or(`search_text.ilike.%${search.replaceAll(",", " ")}%`);
    if (orderBy) query = query.order(orderBy, { ascending, nullsFirst: false });
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], total: count || 0 };
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
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
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
      const { data: fnData, error } = await supabase.functions.invoke(config.edgeFunctions?.createUser || "create-user", { body: payload });
      if (error) throw error;
      return fnData;
    }

    const details = data.details;
    delete data.details;
    if (idempotentTables.has(table)) data.idempotency_key = data.idempotency_key || crypto.randomUUID();
    try {
      const { data: inserted, error } = await supabase.from(table).insert(data).select().single();
      if (error) throw error;
      if (details?.length && childTableMap[table]) {
        const child = childTableMap[table];
        const rows = details.map(detail => ({ ...detail, [child.foreignKey]: inserted.id }));
        const { error: childError } = await supabase.from(child.table).insert(rows);
        if (childError) throw childError;
      }
      return inserted;
    } catch (error) {
      if (!navigator.onLine || /fetch|network/i.test(error.message || "")) {
        queueOperation({ operation: "create", table, payload: { ...data, ...(details ? { details } : {}) }, idempotencyKey: data.idempotency_key });
        return { ...data, ...(details ? { details } : {}), id: `local-${crypto.randomUUID()}`, _queued: true };
      }
      throw error;
    }
  },

  async update(table, id, payload) {
    const data = { ...payload };
    delete data.password;
    if (!isSupabaseConfigured) {
      const db = ensureDemoDb();
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
      if (!navigator.onLine || /fetch|network/i.test(error.message || "")) {
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
        else if (table === "cash_payments") result = demoPostCashPayment(db, id);
        else if (table === "in_kind_receipts") result = demoPostInKindReceipt(db, id);
        else if (table === "in_kind_payments") result = demoPostInKindPayment(db, id);
      } else if (action === "cancel") result = demoCancel(db, table, id, extra.reason);
      else if (action === "approve") record.status = "approved";
      else if (action === "confirm-receipt") record.receipt_status = "received";
      else if (action === "toggle") record.is_active = !record.is_active;
      else if (action === "open-close") record.status = record.status === "open" ? "closed" : "open";
      else if (action === "reopen") {
        record.status = "reopened";
        const campaign = findById(db, "campaigns", record.campaign_id);
        if (campaign) campaign.status = "open";
      }
      record.updated_at = new Date().toISOString();
      auditDemo(db, `${action} ${table}`, table, id, old, record);
      writeDemoDb(db);
      return enrichDemoRow(db, table, result);
    }

    const rpcMap = {
      "cash_receipts:post": "post_cash_receipt",
      "cash_payments:post": "post_cash_payment",
      "in_kind_receipts:post": "post_in_kind_receipt",
      "in_kind_payments:post": "post_in_kind_payment",
      "cash_receipts:cancel": "cancel_cash_receipt",
      "cash_payments:cancel": "cancel_cash_payment",
      "in_kind_receipts:cancel": "cancel_in_kind_receipt",
      "in_kind_payments:cancel": "cancel_in_kind_payment",
      "account_closings:reopen": "reopen_account_closing"
    };
    const rpc = rpcMap[`${table}:${action}`];
    if (rpc) {
      const args = { p_id: id };
      if (extra.reason) args.p_reason = extra.reason;
      if (action === "cancel" && !args.p_reason) args.p_reason = "إلغاء من واجهة النظام";
      if (action === "reopen" && !args.p_reason) args.p_reason = "إعادة فتح من واجهة النظام";
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      return data;
    }
    const patch = action === "approve" ? { status: "approved" }
      : action === "confirm-receipt" ? { receipt_status: "received" }
      : action === "toggle" ? { is_active: extra.current === false }
      : action === "open-close" ? { status: extra.current === "open" ? "closed" : "open" }
      : {};
    const { data, error } = await supabase.from(table).update(patch).eq("id", id).select().single();
    if (error) throw error;
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
    const { data, error } = await supabase.functions.invoke(config.edgeFunctions?.resetUserPassword || "reset-user-password", { body: { user_id: id, password } });
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
