import test from "node:test";
import assert from "node:assert/strict";
import * as currencyService from "../js/currency-service.js";

test("dashboard totals and chart series keep each original currency separate", () => {
  const receipts = [
    { status: "posted", currency: "YER", amount: "1000", receipt_date: "2026-09-01" },
    { status: "posted", currency: "SAR", amount: "20", receipt_date: "2026-09-01" },
    { status: "draft", currency: "YER", amount: "9999", receipt_date: "2026-09-01" },
  ];
  const payments = [
    { status: "posted", currency: "YER", amount: "300", payment_date: "2026-09-02" },
    { status: "posted", currency: "USD", amount: "15", payment_date: "2026-09-02" },
    { status: "cancelled", currency: "YER", amount: "100", payment_date: "2026-09-03" },
  ];
  const summary = currencyService.buildCashFlowSummary(receipts, payments, "YER", new Date(2026, 8, 6));
  assert.equal(summary.receivedTotal, 1000);
  assert.equal(summary.spentTotal, 300);
  assert.deepEqual(summary.received, [0, 0, 0, 0, 0, 1000]);
  assert.deepEqual(summary.spent, [0, 0, 0, 0, 0, 300]);
  const sar = currencyService.buildCashFlowSummary(receipts, payments, "SAR", new Date(2026, 8, 6));
  assert.equal(sar.receivedTotal, 20);
  assert.equal(sar.spentTotal, 0);
  assert.equal(sar.received.at(-1), 20);
});

test("six-month cash flow does not skip February when displayed on a month end", () => {
  const summary = currencyService.buildCashFlowSummary([], [], "YER", new Date(2026, 2, 31));
  assert.deepEqual(summary.months.map(month => month.key), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.equal(summary.receivedTotal, 0);
  assert.equal(summary.spentTotal, 0);
});
