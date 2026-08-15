import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../js/demo-data.js";

const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);

test("demo allocation spend equals posted beneficiary payments", () => {
  for (const allocation of demoData.campaign_distributors) {
    const payments = demoData.cash_payments.filter(row => row.status === "posted" && row.campaign_id === allocation.campaign_id && row.delegate_id === allocation.delegate_id);
    assert.equal(Number(allocation.spent_amount), sum(payments, "amount"), allocation.id);
    assert.ok(Number(allocation.allocated_amount) >= Number(allocation.spent_amount) + Number(allocation.returned_amount), allocation.id);
  }
});

test("every posted transfer has equal outgoing and incoming ledger entries", () => {
  for (const transfer of demoData.cash_transfers.filter(row => row.status === "posted")) {
    const entries = demoData.cashbox_ledger.filter(row => row.reference_table === "cash_transfers" && row.reference_id === transfer.id);
    assert.equal(sum(entries.filter(row => row.transaction_type === "transfer_out"), "debit"), Number(transfer.amount));
    assert.equal(sum(entries.filter(row => row.transaction_type === "transfer_in"), "credit"), Number(transfer.amount));
  }
});

test("posted receipts and campaign funding match their cashbox ledger", () => {
  for (const receipt of demoData.cash_receipts.filter(row => row.status === "posted")) {
    const entries = demoData.cashbox_ledger.filter(row => row.reference_table === "cash_receipts" && row.reference_id === receipt.id && row.transaction_type === "donation");
    assert.equal(sum(entries, "credit"), Number(receipt.amount), receipt.id);
  }
  for (const funding of demoData.campaign_funding.filter(row => row.status === "posted")) {
    const entries = demoData.cashbox_ledger.filter(row => row.reference_table === "campaign_funding" && row.reference_id === funding.id && row.transaction_type === "campaign_funding");
    assert.equal(sum(entries, "debit"), Number(funding.amount), funding.id);
  }
});

test("demo cashboxes and inventory are non-negative", () => {
  for (const cashbox of demoData.cashboxes) {
    const ledger = demoData.cashbox_ledger.filter(row => row.cashbox_id === cashbox.id);
    const balance = Number(cashbox.opening_balance || 0) + sum(ledger, "credit") - sum(ledger, "debit");
    assert.ok(balance >= 0, cashbox.id);
  }
  for (const lot of demoData.inventory_lots) {
    assert.ok(Number(lot.quantity_available) >= 0, lot.id);
    assert.ok(Number(lot.quantity_damaged) >= 0, lot.id);
    assert.ok(Number(lot.quantity_available) + Number(lot.quantity_damaged) <= Number(lot.quantity_received), lot.id);
  }
});
