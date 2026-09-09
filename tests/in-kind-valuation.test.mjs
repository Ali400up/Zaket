import test from "node:test";
import assert from "node:assert/strict";
import { enrichInKindDetails, summarizeInKindValue } from "../js/in-kind-valuation.js";

const items = [
  { id: "item-rice", name: "أرز", unit_id: "unit-bag", purchase_price: 12000, purchase_currency_id: "currency-yer" },
  { id: "item-oil", name: "زيت", unit_id: "unit-box", purchase_price: 80, purchase_currency_id: "currency-sar" },
];
const units = [{ id: "unit-bag", name: "كيس" }, { id: "unit-box", name: "كرتون" }];
const currencies = [{ id: "currency-yer", code: "YER" }, { id: "currency-sar", code: "SAR" }];

test("receipt valuation ignores client supplied cost and snapshots the item purchase price", () => {
  const [detail] = enrichInKindDetails(
    [{ item_id: "item-rice", quantity: 3, valid_qty: 3, damaged_qty: 0, unit_cost: 1, cost_currency: "USD" }],
    { items, units, currencies, forceSnapshot: true },
  );
  assert.equal(detail.item_name, "أرز");
  assert.equal(detail.unit_name, "كيس");
  assert.equal(detail.unit_cost, 12000);
  assert.equal(detail.cost_currency, "YER");
  assert.equal(detail.total_cost, 36000);
});

test("receipt totals remain separate for each currency", () => {
  const details = enrichInKindDetails([
    { item_id: "item-rice", quantity: 3, valid_qty: 3, damaged_qty: 0 },
    { item_id: "item-oil", quantity: 2, valid_qty: 1, damaged_qty: 1 },
  ], { items, units, currencies, forceSnapshot: true });
  assert.deepEqual(summarizeInKindValue(details), [
    { currency: "SAR", amount: 160 },
    { currency: "YER", amount: 36000 },
  ]);
});

test("receipt valuation rejects an item without a valid positive purchase price", () => {
  assert.throws(
    () => enrichInKindDetails([{ item_id: "bad", quantity: 1 }], { items: [{ id: "bad", name: "غير مسعر", purchase_price: 0 }], units, currencies, forceSnapshot: true }),
    /سعر شراء موجب/,
  );
});
