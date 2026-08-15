import test from "node:test";
import assert from "node:assert/strict";
import {
  money, nextBeneficiaryStatus, nextCampaignDistributorStatus, nextDeviceStatus,
  settleAllocation, reopenAllocation, cancelPaymentAgainstAllocation, validateCashTransfer
} from "../js/state-machines.js";

test("rounds monetary values to database precision", () => {
  assert.equal(money(0.1 + 0.2), 0.3);
  assert.equal(money("120.005"), 120.01);
  assert.throws(() => money("not-a-number"));
});

test("uses explicit toggle state machines", () => {
  assert.equal(nextBeneficiaryStatus("approved"), "suspended");
  assert.equal(nextBeneficiaryStatus("suspended"), "approved");
  assert.throws(() => nextBeneficiaryStatus("under_review"));
  assert.equal(nextCampaignDistributorStatus("active"), "suspended");
  assert.equal(nextCampaignDistributorStatus("suspended"), "active");
  assert.throws(() => nextCampaignDistributorStatus("settled"));
  assert.equal(nextDeviceStatus("approved"), "blocked");
  assert.equal(nextDeviceStatus("pending"), "approved");
});

test("settlement stores only its automatic return and reopening restores it", () => {
  const original = { allocated_amount: 1000, spent_amount: 425.25, returned_amount: 74.75, status: "active" };
  const settled = { ...settleAllocation(original), settled_at: "2026-08-15T00:00:00Z" };
  assert.equal(settled.returned_amount, 574.75);
  assert.equal(settled.settled_return_amount, 500);
  assert.equal(settled.remaining_amount, 0);
  const reopened = reopenAllocation(settled, 500);
  assert.equal(reopened.returned_amount, 74.75);
  assert.equal(reopened.remaining_amount, 500);
  assert.equal(reopened.status, "active");
});

test("settlement rejects overspent allocation and reopening rejects corrupt marker", () => {
  assert.throws(() => settleAllocation({ allocated_amount: 100, spent_amount: 101, returned_amount: 0 }));
  assert.throws(() => reopenAllocation({ status: "settled", settled_at: "x", returned_amount: 20, settled_return_amount: 21 }, 30));
  assert.throws(() => reopenAllocation({ status: "settled", settled_at: "x", allocated_amount: 100, spent_amount: 60, returned_amount: 40, settled_return_amount: 40 }, 39.99));
});

test("cancelling a payment after settlement preserves a reversible zero balance", () => {
  const settled = { allocated_amount: 100, spent_amount: 60, returned_amount: 40, settled_return_amount: 40, status: "settled", settled_at: "2026-08-15T00:00:00Z" };
  const cancelled = cancelPaymentAgainstAllocation(settled, 20);
  assert.equal(cancelled.spent_amount, 40);
  assert.equal(cancelled.returned_amount, 60);
  assert.equal(cancelled.settled_return_amount, 60);
  assert.equal(cancelled.remaining_amount, 0);
  assert.equal(cancelled.status, "settled");
  assert.throws(() => cancelPaymentAgainstAllocation(settled, 61));
});

test("cash transfer validates identity, status, currency and balance", () => {
  const from = { id: "a", currency: "YER", is_active: true, current_balance: 1000 };
  const to = { id: "b", currency: "YER", is_active: true };
  assert.deepEqual(validateCashTransfer({ from, to, amount: 250.125 }), { amount: 250.13, currency: "YER" });
  assert.throws(() => validateCashTransfer({ from, to: { ...to, id: "a" }, amount: 1 }));
  assert.throws(() => validateCashTransfer({ from, to: { ...to, currency: "USD" }, amount: 1 }));
  assert.throws(() => validateCashTransfer({ from, to, amount: 1000.01 }));
  assert.throws(() => validateCashTransfer({ from: { ...from, is_active: false }, to, amount: 1 }));
});
