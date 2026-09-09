import test from "node:test";
import assert from "node:assert/strict";
import { requestSystemHealth, healthMetric, describeHealthError } from "../js/system-health.js";

test("a missing database column leaves local status available with the actual error", async () => {
  const result = await requestSystemHealth({
    online: true, localMetrics: { cache_bytes: 512 },
    client: { rpc: async () => ({ data: null, error: { code: "42703", message: 'column "revision" does not exist' } }) },
  });
  assert.equal(result.cache_bytes, 512);
  assert.equal(result.diagnostic_code, "42703");
  assert.match(result.diagnostic_error, /revision/);
  assert.equal(healthMetric(result, "database_bytes"), null);
  assert.match(describeHealthError({ code: result.diagnostic_code, message: result.diagnostic_error }).action, /database_complete\.sql/);
});

test("offline status never invents zero usage, a full remaining quota, or healthy accounts", async () => {
  let calls = 0;
  const result = await requestSystemHealth({ online: false, localMetrics: { cache_bytes: 400 }, client: { rpc() { calls++; } } });
  assert.equal(calls, 0);
  assert.equal(result.offline, true);
  assert.equal(result.cache_bytes, 400);
  for (const key of ["storage_bytes", "database_bytes", "financial_integrity_failures", "missing_attachment_files"]) assert.equal(healthMetric(result, key), null);
  for (const value of [null, undefined, "", NaN, Infinity, -1, false]) assert.equal(healthMetric({ value }, "value"), null);
  assert.equal(healthMetric({ value: 0 }, "value"), 0);
});

test("partial diagnostics preserve healthy measurements without masking a failed check", async () => {
  const result = await requestSystemHealth({ online: true, client: { rpc: async () => ({ data: { database_bytes: 1200, status: "partial", diagnostic_errors: [{ section: "financial", message: "missing view" }] } }) } });
  assert.equal(healthMetric(result, "database_bytes"), 1200);
  assert.equal(healthMetric(result, "financial_integrity_failures"), null);
  assert.equal(result.diagnostic_errors.length, 1);
});

test("a stalled RPC is cancelled so the status page can finish rendering", async () => {
  let signal;
  const result = await requestSystemHealth({ online: true, timeoutMs: 5,
    client: { rpc: () => ({ abortSignal(value) { signal = value; return new Promise(() => {}); } }) },
  });
  assert.equal(signal.aborted, true);
  assert.equal(result.live_unavailable, true);
  assert.match(result.diagnostic_error, /انتهت مهلة/);
});

test("permission failures recommend approved administrator access", () => {
  assert.match(describeHealthError({ code: "42501", message: "denied" }).action, /مدير نشط/);
});
