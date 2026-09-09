import test from "node:test";
import assert from "node:assert/strict";

import { filterSearchOptions, normalizeSearchText, shouldUseSearchableSelect } from "../js/searchable-select.js";

const options = [
  { value: "1", label: "أحمد علي", row: { file_no: "BEN-001", phone: "777000001" } },
  { value: "2", label: "محمد صالح", row: { file_no: "BEN-002", phone: "777000002" } },
  { value: "3", label: "إيمان حسن", row: { file_no: "BEN-003", phone: "777000003" } }
];

test("normalizes common Arabic variations and filters operational labels", () => {
  assert.equal(normalizeSearchText("  إِيمَانـ  "), "ايمان");
  assert.deepEqual(filterSearchOptions(options, "ايمان").map(row => row.value), ["3"]);
  assert.deepEqual(filterSearchOptions(options, "BEN-002", ["file_no"]).map(row => row.value), ["2"]);
});

test("beneficiary phone is not searched unless explicitly allowed", () => {
  assert.deepEqual(filterSearchOptions(options, "777000001").map(row => row.value), []);
  assert.deepEqual(filterSearchOptions(options, "777000001", ["phone"]).map(row => row.value), ["1"]);
});

test("large relations become searchable above eight options", () => {
  assert.equal(shouldUseSearchableSelect(8), false);
  assert.equal(shouldUseSearchableSelect(9), true);
  assert.equal(shouldUseSearchableSelect(1, 0), true, "a forced threshold makes beneficiary fields searchable");
});

