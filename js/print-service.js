const SENSITIVE_KEYS = new Set([
  "phone", "phone_secondary", "representative_phone", "national_id", "identity_no",
  "email", "address", "governorate", "district", "village", "guardian_name",
  "profile_image_url", "identity_image_url", "attachment_url", "proof_url", "storage_path",
  "created_by", "updated_by", "approved_by", "user_id", "device_fingerprint",
  "fingerprint", "ip_address",
]);

const TECHNICAL_KEYS = /(^id$|_id$|_url$|table_name|search_text|idempotency|checksum|sha256|metadata|old_data|new_data|session_info)/i;

const labels = {
  posted: "مرحّل", cancelled: "ملغي", draft: "مسودة", approved: "معتمد",
  under_review: "تحت المراجعة", received: "تم الاستلام", pending: "بانتظار الاستلام",
  cash: "نقدًا", bank: "تحويل بنكي", exchange: "حوالة صرافة", online: "دفع إلكتروني",
  basket: "سلة", manual: "أصناف يدوية",
  active: "نشط", inactive: "موقوف", suspended: "موقوف", rejected: "مرفوض",
  open: "مفتوحة", closed: "مغلقة", completed: "مكتملة", reopened: "معاد فتحه",
  individual: "فرد", organization: "جهة",
  admin: "مدير النظام", supervisor: "مشرف", accountant: "محاسب", distributor: "موزع",
  data_entry: "مدخل بيانات", warehouse: "مسؤول مخزون", auditor: "مراجع",
  true: "نعم", false: "لا", male: "ذكر", female: "أنثى",
  single: "أعزب", married: "متزوج", widowed: "أرمل", divorced: "مطلق",
  INSERT: "إضافة", UPDATE: "تعديل", DELETE: "حذف", success: "ناجحة", failed: "فاشلة",
};

const titles = {
  cash_receipts: "سند قبض نقدي",
  cash_payments: "سند صرف نقدي",
  cash_transfers: "سند تحويل بين الصناديق",
  currency_exchanges: "سند مصارفة عملات",
  campaign_funding: "سند تمويل حملة",
  in_kind_receipts: "سند قبض عيني",
  campaign_in_kind_funding: "سند تمويل حملة عيني",
  in_kind_payments: "سند صرف عيني",
  account_closings: "محضر إقفال حساب",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAssetUrl(value, fallback) {
  const text = String(value || fallback || "").trim();
  if (!text || /^(javascript|data:text\/html):/i.test(text)) return fallback;
  return text;
}

function number(value, maximumFractionDigits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return parsed.toLocaleString("en-US", { maximumFractionDigits });
}

function money(value, currency) {
  return `${number(value)}${currency ? ` ${escapeHtml(currency)}` : ""}`;
}

function date(value, includeTime = false) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("ar-YE", includeTime
    ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function display(value) {
  if (value === null || value === undefined || value === "") return "-";
  return escapeHtml(labels[value] || value);
}

function partyName(record, kind) {
  if (kind === "donor" && (record.donor_is_anonymous === true || record.is_anonymous === true)) return "فاعل خير";
  return record[`${kind}_display_name`] || record[`${kind}_name`] || "-";
}

function field(label, value, options = {}) {
  const rendered = options.money ? money(value, options.currency)
    : options.date ? date(value, options.time)
      : display(value);
  return `<div class="print-field"><span>${escapeHtml(label)}</span><strong>${rendered}</strong></div>`;
}

function itemRows(details = [], { valued = false } = {}) {
  return details.map((item, index) => {
    const qty = Number(item.quantity ?? item.valid_qty ?? 0);
    const cost = Number(item.unit_cost ?? item.purchase_price ?? 0);
    const currency = item.cost_currency || item.purchase_currency_code || item.currency || "";
    return `<tr><td>${index + 1}</td><td>${escapeHtml(item.item_name || item.name || "صنف غير مسمى")}</td><td>${escapeHtml(item.unit_name || item.unit_symbol || "-")}</td><td>${number(qty, 3)}</td>${item.valid_qty !== undefined ? `<td>${number(item.valid_qty, 3)}</td><td>${number(item.damaged_qty || 0, 3)}</td>` : ""}${valued ? `<td>${money(cost, currency)}</td><td>${money(qty * cost, currency)}</td>` : ""}</tr>`;
  }).join("");
}

function groupedValueTotals(details = []) {
  const totals = new Map();
  for (const item of details) {
    const currency = item.cost_currency || item.purchase_currency_code || item.currency || "غير محدد";
    const value = Number(item.quantity ?? item.valid_qty ?? 0) * Number(item.unit_cost ?? item.purchase_price ?? 0);
    if (Number.isFinite(value)) totals.set(currency, (totals.get(currency) || 0) + value);
  }
  return [...totals.entries()].map(([currency, total]) => `<span><b>${money(total, currency)}</b></span>`).join("");
}

function itemTable(record, { valued = false } = {}) {
  const details = Array.isArray(record.details) ? record.details : [];
  const hasCondition = details.some(item => item.valid_qty !== undefined);
  return `<section class="print-items"><h2>الأصناف</h2><table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th>${hasCondition ? "<th>الصالح</th><th>التالف</th>" : ""}${valued ? "<th>سعر الشراء</th><th>الإجمالي</th>" : ""}</tr></thead><tbody>${itemRows(details, { valued }) || `<tr><td colspan="${valued ? 8 : 6}">لا توجد أصناف</td></tr>`}</tbody></table>${valued ? `<div class="value-totals"><span>إجمالي قيمة البضاعة</span>${groupedValueTotals(details)}</div>` : ""}</section>`;
}

function summaryFor(table, record) {
  switch (table) {
    case "cash_receipts": return [
      field("رقم السند", record.voucher_no), field("التاريخ", record.receipt_date, { date: true }),
      field("المتبرع", partyName(record, "donor")), field("الصندوق المستلم", record.cashbox_name),
      field("طريقة القبض", record.method), field("رقم المرجع", record.reference_no),
      field("المبلغ", record.amount, { money: true, currency: record.currency }), field("الحالة", record.status),
    ].join("");
    case "cash_payments": return [
      field("رقم السند", record.voucher_no), field("التاريخ", record.payment_date, { date: true }),
      field("المستفيد", partyName(record, "beneficiary")), field("المستلم الفعلي", record.actual_recipient),
      field("الحملة", record.campaign_name), field("الموزع", record.delegate_name),
      field("الصندوق", record.cashbox_name), field("المبلغ", record.amount, { money: true, currency: record.currency }),
      field("حالة الاستلام", record.receipt_status), field("الحالة", record.status),
    ].join("");
    case "cash_transfers": return [
      field("رقم التحويل", record.transfer_no), field("التاريخ", record.transfer_date, { date: true }),
      field("من صندوق", record.from_cashbox_name), field("إلى صندوق", record.to_cashbox_name),
      field("المبلغ", record.amount, { money: true, currency: record.currency }), field("الحالة", record.status),
    ].join("");
    case "currency_exchanges": return [
      field("رقم العملية", record.exchange_no), field("التاريخ", record.exchange_date, { date: true }),
      field("من صندوق", record.from_cashbox_name), field("إلى صندوق", record.to_cashbox_name),
      field("المبلغ المصدر", record.from_amount, { money: true, currency: record.from_currency }),
      field("سعر الصرف", record.exchange_rate),
      field("المبلغ المستلم", record.to_amount, { money: true, currency: record.to_currency }),
      field("العمولة", record.fees, { money: true, currency: record.from_currency }), field("الحالة", record.status),
    ].join("");
    case "campaign_funding": return [
      field("رقم التمويل", record.funding_no), field("التاريخ", record.funding_date, { date: true }),
      field("الحملة", record.campaign_name), field("الصندوق", record.cashbox_name),
      field("المبلغ", record.amount, { money: true, currency: record.currency }), field("الحالة", record.status),
    ].join("");
    case "in_kind_receipts": return [
      field("رقم السند", record.voucher_no), field("التاريخ", record.receipt_date, { date: true }),
      field("المتبرع", partyName(record, "donor")), field("المخزن المستلم", record.warehouse_name),
      field("استلمها", record.received_by_name || record.created_by_name), field("الحالة", record.status),
    ].join("");
    case "campaign_in_kind_funding": return [
      field("رقم التمويل", record.funding_no), field("التاريخ", record.funding_date, { date: true }),
      field("الحملة", record.campaign_name), field("المخزن المصدر", record.warehouse_name), field("الحالة", record.status),
    ].join("");
    case "in_kind_payments": return [
      field("رقم السند", record.voucher_no), field("التاريخ", record.payment_date, { date: true }),
      field("المستفيد", partyName(record, "beneficiary")), field("المستلم الفعلي", record.actual_recipient),
      field("الحملة", record.campaign_name), field("الموزع", record.delegate_name),
      field("نوع الصرف", record.distribution_type), field("حالة الاستلام", record.receipt_status), field("الحالة", record.status),
    ].join("");
    case "account_closings": return [
      field("رقم الإقفال", record.closing_no), field("الحملة", record.campaign_name),
      field("إجمالي التمويل", record.total_received, { money: true, currency: record.currency }),
      field("إجمالي المصروف", record.total_spent, { money: true, currency: record.currency }),
      field("المتبقي", record.balance, { money: true, currency: record.currency }),
      field("الفروقات", record.difference, { money: true, currency: record.currency }), field("الحالة", record.status),
    ].join("");
    default: return Object.entries(record)
      .filter(([key, value]) => !SENSITIVE_KEYS.has(key) && !TECHNICAL_KEYS.test(key) && typeof value !== "object")
      .slice(0, 16).map(([key, value]) => field(key, value)).join("");
  }
}

function printStyles() {
  return `
    @page{size:A4;margin:11mm}*{box-sizing:border-box}body{margin:0;color:#172b45;background:#fff;font-family:"Zakat Print","Tajawal",Arial,sans-serif;font-size:11pt;line-height:1.55}
    .print-page{min-height:272mm;display:flex;flex-direction:column}.print-header{display:flex;align-items:center;gap:14px;padding:0 0 12px;border-bottom:3px solid #0f67d8}.print-logo{width:62px;height:62px;object-fit:contain}.print-brand{flex:1}.print-brand strong{display:block;font-size:17pt;color:#0a3f86}.print-brand span{display:block;color:#52677f}.print-title{text-align:left}.print-title h1{margin:0;color:#0f67d8;font-size:18pt}.print-title small{display:block;margin-top:3px;color:#6b7d91}.print-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:16px 0}.print-field{border:1px solid #d9e2ec;border-radius:7px;padding:7px 10px;min-height:52px}.print-field span{display:block;color:#63768c;font-size:8.5pt}.print-field strong{display:block;color:#172b45;font-size:11pt}.print-items{margin-top:5px}.print-items h2{font-size:12pt;margin:0 0 7px;color:#0a3f86}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #cfd9e4;padding:6px 7px;text-align:right}th{background:#eaf4ff;color:#0a3f86;font-weight:700}td:first-child,th:first-child{text-align:center;width:34px}.value-totals{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;padding:9px 12px;background:#f3f8fd;border:1px solid #d8e6f4;border-radius:7px}.value-totals>span:first-child{margin-inline-end:auto;color:#536b84}.print-notes{margin-top:12px;border:1px dashed #cbd7e3;border-radius:7px;padding:9px}.print-notes span{display:block;color:#63768c;font-size:8.5pt}.print-footer{margin-top:auto;padding-top:22px}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;text-align:center}.signature{padding-top:30px;border-top:1px solid #7a8ba0}.footer-note{text-align:center;border-top:1px solid #dfe6ee;margin-top:24px;padding-top:8px;color:#63768c;font-size:8.5pt}.print-meta{display:flex;justify-content:space-between;gap:12px;margin-top:5px;color:#7b8da1;font-size:7.5pt}.list-table{font-size:9pt}.list-table th,.list-table td{padding:5px}.watermark{position:fixed;inset:45% 0 auto;text-align:center;font-size:48pt;opacity:.035;transform:rotate(-25deg);pointer-events:none}@media print{.print-page{min-height:auto}}
  `;
}

function shell({ title, settings, actor, printedAt, body, record }) {
  const logo = safeAssetUrl(settings.logo_url, "assets/logo.svg");
  const fontRegular = safeAssetUrl(settings.print_font_url, "assets/fonts/Tajawal-Regular.ttf");
  const printedBy = actor?.full_name || actor?.name || "مستخدم النظام";
  const includeNotes = settings.print_include_notes === true && record?.notes;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>@font-face{font-family:"Zakat Print";src:url("${escapeHtml(fontRegular)}") format("truetype");font-weight:400;font-display:swap}${printStyles()}</style></head><body><main class="print-page"><div class="watermark">${escapeHtml(settings.organization_name || "")}</div><header class="print-header"><img class="print-logo" src="${escapeHtml(logo)}" alt="شعار الجهة"><div class="print-brand"><strong>${escapeHtml(settings.organization_name || "الجهة")}</strong><span>${escapeHtml(settings.system_name || "نظام إدارة الزكاة والتبرعات")}</span></div><div class="print-title"><h1>${escapeHtml(title)}</h1><small>${escapeHtml(record?.voucher_no || record?.funding_no || record?.transfer_no || record?.exchange_no || record?.closing_no || "")}</small></div></header>${body}${includeNotes ? `<div class="print-notes"><span>البيان</span><strong>${escapeHtml(record.notes)}</strong></div>` : ""}<footer class="print-footer"><div class="signatures"><div class="signature">توقيع المستلم</div><div class="signature">توقيع المسؤول</div><div class="signature">الختم</div></div><div class="footer-note">${escapeHtml(settings.print_footer || "")}</div><div class="print-meta"><span>طبع بواسطة: ${escapeHtml(printedBy)}</span><span>تاريخ الطباعة: ${date(printedAt || new Date().toISOString(), true)}</span></div></footer></main><script>addEventListener("load",()=>Promise.resolve(document.fonts&&document.fonts.ready).finally(()=>setTimeout(()=>window.print(),80)));<\/script></body></html>`;
}

export function buildRecordPrintDocument({ table, record = {}, settings = {}, actor = {}, printedAt } = {}) {
  const title = titles[table] || "مستند نظام";
  const valued = table === "in_kind_receipts";
  const hasItems = ["in_kind_receipts", "campaign_in_kind_funding", "in_kind_payments"].includes(table);
  const body = `<section class="print-summary">${summaryFor(table, record)}</section>${hasItems ? itemTable(record, { valued }) : ""}`;
  return shell({ title, settings, actor, printedAt, body, record });
}

function listValue(row, column) {
  const value = row[column.key];
  if (column.type === "currency") return money(value, row.currency || row.from_currency || "");
  if (column.type === "number") return number(value, 3);
  if (column.type === "date") return date(value);
  if (column.type === "datetime") return date(value, true);
  return display(value);
}

export function buildListPrintDocument({ title = "كشف بيانات", columns = [], rows = [], settings = {}, actor = {}, printedAt } = {}) {
  const visible = columns.filter(column => !column.sensitive && !SENSITIVE_KEYS.has(column.key) && !TECHNICAL_KEYS.test(column.key));
  const body = `<section class="print-items"><h2>${escapeHtml(title)} — ${number(rows.length, 0)} سجل</h2><table class="list-table"><thead><tr><th>#</th>${visible.map(column => `<th>${escapeHtml(column.label || column.key)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td>${visible.map(column => `<td>${listValue(row, column)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${visible.length + 1}">لا توجد بيانات</td></tr>`}</tbody></table></section>`;
  return shell({ title, settings, actor, printedAt, body, record: null });
}
