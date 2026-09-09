import test from "node:test";
import assert from "node:assert/strict";
import { formatOperationError } from "../js/error-presenter.js";

test("backup and restore failures show a useful cause, remedy, and reference", () => {
  const network = formatOperationError(new Error("Failed to fetch"), "backup");
  assert.equal(network.code, "NETWORK");
  assert.match(network.message, /السبب:/);
  assert.match(network.message, /الحل:/);
  assert.match(network.message, /المرجع: BKP-NETWORK/);

  const corrupt = formatOperationError(new Error("checksum mismatch for file"), "restore");
  assert.equal(corrupt.code, "INTEGRITY");
  assert.match(corrupt.message, /لا تعتمد الملف/);
});

