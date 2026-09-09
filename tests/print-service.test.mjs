import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecordPrintDocument,
  buildListPrintDocument,
} from "../js/print-service.js";
import { formatPrivateValue } from "../js/screen-values.js";
import { screenConfigs } from "../js/screen-config.js";

const baseSettings = {
  organization_name: "مؤسسة الخير",
  system_name: "نظام الزكاة",
  logo_url: "assets/logo.svg",
  print_footer: "جزاكم الله خيراً",
};

test("in-kind receipt print renders receiver, warehouse, priced items, and totals without private fields", () => {
  const html = buildRecordPrintDocument({
    table: "in_kind_receipts",
    record: {
      id: "36f6dd02-2547-454b-b871-secret",
      voucher_no: "IKR-2026-0009",
      receipt_date: "2026-09-04",
      donor_name: "متبرع سري",
      donor_is_anonymous: true,
      donor_phone: "777123456",
      donor_identity_no: "0102030405",
      warehouse_name: "المخزن العام",
      received_by_name: "أحمد محمد",
      status: "posted",
      notes: "مواد غذائية",
      attachment_url: "users/private/receipt.jpg",
      details: [
        { item_name: "أرز", unit_name: "كيس", quantity: 3, valid_qty: 3, damaged_qty: 0, unit_cost: 12000, cost_currency: "YER" },
        { item_name: "زيت", unit_name: "كرتون", quantity: 2, valid_qty: 1, damaged_qty: 1, unit_cost: 80, cost_currency: "SAR" },
      ],
    },
    settings: baseSettings,
    actor: { full_name: "مدير النظام" },
    printedAt: "2026-09-04T12:00:00.000Z",
  });

  assert.match(html, /سند قبض عيني/);
  assert.match(html, /IKR-2026-0009/);
  assert.match(html, /فاعل خير/);
  assert.doesNotMatch(html, /متبرع سري/);
  assert.match(html, /المخزن العام/);
  assert.match(html, /أحمد محمد/);
  assert.match(html, /أرز/);
  assert.match(html, /كيس/);
  assert.match(html, /36,000/);
  assert.match(html, /80/);
  assert.match(html, /YER/);
  assert.match(html, /SAR/);
  assert.doesNotMatch(html, /777123456|0102030405|private\/receipt|36f6dd02/);
  assert.match(html, /توقيع المستلم/);
  assert.match(html, /توقيع المسؤول/);
});

test("cash receipt print uses human labels and never leaks technical or personal fields", () => {
  const html = buildRecordPrintDocument({
    table: "cash_receipts",
    record: {
      id: "receipt-private-id",
      voucher_no: "CR-2026-0088",
      receipt_date: "2026-09-04",
      donor_name: "محمد علي",
      cashbox_name: "الصندوق الرئيسي",
      amount: 125000,
      currency: "YER",
      method: "cash",
      phone: "771111111",
      identity_no: "99887766",
      status: "posted",
    },
    settings: baseSettings,
    actor: { full_name: "المحاسب" },
  });

  assert.match(html, /سند قبض نقدي/);
  assert.match(html, /محمد علي/);
  assert.match(html, /الصندوق الرئيسي/);
  assert.match(html, /125,000/);
  assert.doesNotMatch(html, /receipt-private-id|771111111|99887766/);
});

test("list print uses only explicitly visible non-sensitive columns", () => {
  const html = buildListPrintDocument({
    title: "دليل المتبرعين",
    columns: [
      { key: "name", label: "المتبرع" },
      { key: "phone", label: "الهاتف", sensitive: true },
      { key: "ip_address", label: "عنوان الشبكة" },
      { key: "fingerprint", label: "بصمة الجهاز" },
      { key: "table_name", label: "اسم الجدول" },
      { key: "cash_total", label: "إجمالي النقدي", type: "currency" },
    ],
    rows: [{
      name: "فاعل خير",
      phone: "777000000",
      ip_address: "192.0.2.44",
      fingerprint: "private-device-fingerprint",
      table_name: "cash_receipts",
      cash_total: 5000,
      currency: "YER",
      identity_no: "secret",
    }],
    settings: baseSettings,
    actor: { full_name: "المراجع" },
  });

  assert.match(html, /دليل المتبرعين/);
  assert.match(html, /فاعل خير/);
  assert.match(html, /5,000/);
  assert.doesNotMatch(html, /الهاتف|777000000|secret|192\.0\.2\.44|private-device-fingerprint|cash_receipts/);
});

test("list print translates system values into clear Arabic labels", () => {
  const html = buildListPrintDocument({
    title: "كشف المستخدمين والمتبرعين",
    columns: [
      { key: "donor_type", label: "النوع" },
      { key: "role", label: "الدور", type: "role" },
      { key: "is_active", label: "الحالة", type: "boolean" },
    ],
    rows: [{ donor_type: "individual", role: "admin", is_active: true }],
    settings: baseSettings,
  });

  assert.match(html, /فرد/);
  assert.match(html, /مدير النظام/);
  assert.match(html, /نعم/);
  assert.doesNotMatch(html, />individual<|>admin<|>true</);
});

test("sensitive values remain visible inside authorized system screens", () => {
  assert.equal(formatPrivateValue("771234567"), "771234567");
  assert.equal(formatPrivateValue(""), "-");
  assert.equal(formatPrivateValue(null), "-");
});

test("donor and beneficiary directories mark identity and phone columns as protected", () => {
  const donorIdentity = screenConfigs.donors.columns.find(column => column.key === "identity_no");
  const donorName = screenConfigs.donors.columns.find(column => column.key === "name");
  const beneficiaryIdentity = screenConfigs.beneficiaries.columns.find(column => column.key === "national_id");
  const beneficiaryPhone = screenConfigs.beneficiaries.columns.find(column => column.key === "phone");
  assert.equal(donorIdentity?.sensitive, true);
  assert.notEqual(donorName?.subKey, "phone");
  assert.equal(beneficiaryIdentity?.sensitive, true);
  assert.equal(beneficiaryPhone?.sensitive, true);
  assert.notEqual(screenConfigs.quick_delivery.columns.find(column => column.key === "beneficiary_name")?.subKey, "phone");
});

test("every financial voucher exposes professional printing", () => {
  for (const key of ["campaign_funding", "cash_receipts", "cash_payments", "in_kind_receipts", "campaign_in_kind_funding", "in_kind_payments", "cash_transfers", "currency_exchanges", "closings"])
    assert.ok(screenConfigs[key].actions.includes("print"), `${key} must be printable`);
});
