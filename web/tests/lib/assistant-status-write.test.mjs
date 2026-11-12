import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusWriteError, writeAssistantStatus } from "../../src/lib/assistant-status-write.mjs";

function response(status, body) { return new Response(JSON.stringify(body), { status }); }
test("a matching canonical acknowledgement confirms one explicit write", async () => {
  const requests = [];
  await writeAssistantStatus("007", "Rejected", async (url, init) => {
    requests.push({ url, data: JSON.parse(init.body), signal: init.signal });
    return response(200, { ok: true, status: "Rejected", changed: false });
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].data, { n: "007", status: "Rejected" });
  assert.equal(requests[0].url, "/api/status");
  assert.ok(requests[0].signal instanceof AbortSignal);
});
test("only the server's known lock timeout authorizes retry", async () => {
  let requests = 0;
  await assert.rejects(writeAssistantStatus("11", "Rejected", async () => {
    requests++; return response(503, { error: "Tracker busy", code: "lock-timeout" });
  }), (e) => e instanceof StatusWriteError && e.retryable && !e.unconfirmed && /not saved/.test(e.message));
  assert.equal(requests, 1, "no automatic retry");
});
for (const [status, body] of [
  [400, { error: "Invalid state" }], [404, { error: "Missing row" }],
  [409, { error: "Ambiguous row" }], [503, { code: "core-script-missing", error: "Data-only root" }],
]) test(`pre-write rejection ${status} is visible but not retried blindly`, async () => {
  await assert.rejects(writeAssistantStatus("11", "Rejected", async () => response(status, body)),
    (e) => !e.retryable && !e.unconfirmed && /not saved/.test(e.message));
});
for (const [status, body] of [
  [504, { error: "may or may not have been applied" }], [500, { error: "write failed" }],
  [503, { error: "unknown gateway failure" }], [200, { ok: true, status: "Interview" }],
  [200, { ok: false }],
]) test(`ambiguous response ${status}/${JSON.stringify(body)} never confirms or enables retry`, async () => {
  await assert.rejects(writeAssistantStatus("11", "Rejected", async () => response(status, body)),
    (e) => e.unconfirmed && !e.retryable && /Check the current tracker/.test(e.message));
});
test("network failures and unreadable success bodies remain unconfirmed", async () => {
  for (const fetchFn of [async () => { throw new Error("disconnected"); }, async () => new Response("broken json")]) {
    await assert.rejects(writeAssistantStatus("11", "Rejected", fetchFn), (e) => e.unconfirmed && !e.retryable);
  }
});
