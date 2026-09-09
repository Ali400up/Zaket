import test from "node:test";
import assert from "node:assert/strict";

import { convertCurrency, deriveExchangeRate } from "../js/currency-service.js";

test("converts through directory rates relative to the base currency", () => {
  assert.equal(convertCurrency(1, 140, 1), 140, "1 SAR must equal 140 YER");
  assert.equal(convertCurrency(140, 1, 140), 1, "140 YER must equal 1 SAR");
  assert.equal(convertCurrency(2, 550, 140), 7.86, "USD to SAR rounds to money precision");
  assert.equal(convertCurrency(25, 1, 1), 25, "base conversion is stable");
});

test("derives a target-per-source rate and supports explicit precision", () => {
  assert.equal(deriveExchangeRate(140, 1), 140);
  assert.equal(deriveExchangeRate(1, 140), 1 / 140);
  assert.equal(convertCurrency(1, 1, 3, 4), 0.3333);
});

test("rejects invalid amounts, rates, and precision", () => {
  for (const args of [[-1, 1, 1], [1, 0, 1], [1, 1, 0], [1, -2, 1]]) {
    assert.throws(() => convertCurrency(...args), /أكبر من أو يساوي صفر|أكبر من صفر/);
  }
  assert.throws(() => convertCurrency(1, 1, 1, 20), /الدقة/);
});
