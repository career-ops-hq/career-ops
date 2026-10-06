import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationKey, applySavedStatus, saveStatus } from "../../src/lib/pipeline-status.mjs";

const row = { n: "11", company: "Fixture Alpha", role: "Engineer", date: "2026-10-02", report: "", status: "Evaluated" };
const other = { ...row, n: "12", company: "Fixture Beta" };

test("application identity survives sorting and status changes, but not tracker-number reuse", () => {
  assert.equal(applicationKey(row), applicationKey({ ...row, status: "Applied" }));
  for (const field of ["company", "role", "date", "report"]) {
    assert.notEqual(applicationKey(row), applicationKey({ ...row, [field]: "replacement" }));
  }
});

test("confirmed saves replay over a reordered stale snapshot without mutating it", () => {
  const base = Object.freeze([Object.freeze(other), Object.freeze(row)]);
  const saved = { key: applicationKey(row), status: "Applied" };
  const result = applySavedStatus(base, saved);
  assert.equal(result[0], other);
  assert.equal(result[1].status, "Applied");
  assert.equal(row.status, "Evaluated");
  assert.equal(result.filter((r) => r.status === "Applied").length, 1);
  assert.equal(result.filter((r) => r.status === "Evaluated").length, 1);
});

test("a late save cannot change a removed or replaced application", () => {
  const replacement = { ...row, role: "Different job" };
  const saved = { key: applicationKey(row), status: "Hired" };
  assert.deepEqual(applySavedStatus([other], saved), [other]);
  assert.equal(applySavedStatus([replacement], saved)[0], replacement);
});

test("independent confirmed saves compose in either completion order", () => {
  const first = { key: applicationKey(row), status: "Applied" };
  const second = { key: applicationKey(other), status: "Rejected" };
  assert.deepEqual(
    applySavedStatus(applySavedStatus([row, other], first), second),
    applySavedStatus(applySavedStatus([row, other], second), first),
  );
});

test("same-value selection never writes", async () => {
  assert.equal(await saveStatus("11", "Applied", "Applied", () => { assert.fail("must not fetch"); }), null);
});

test("save uses the existing row-number contract and requires confirmed success", async () => {
  const status = await saveStatus("11", "Evaluated", "Applied", async (url, options) => {
    assert.equal(url, "/api/status");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { n: "11", status: "Applied" });
    assert.equal(options.headers["Content-Type"], "application/json");
    return Response.json({ ok: true, status: "Applied", changed: true, statusLogged: true });
  });
  assert.equal(status, "Applied");
});

test("unchanged-but-confirmed success is accepted", async () => {
  assert.equal(await saveStatus("11", "Evaluated", "Applied", async () => Response.json({ ok: true, status: "Applied", changed: false })), "Applied");
});

for (const code of [400, 404, 409, 503, 504]) {
  test(`HTTP ${code} is an error, never a saved status`, async () => {
    await assert.rejects(saveStatus("11", "Evaluated", "Applied", async () => Response.json({ error: "Fixture write failed" }, { status: code })), /Fixture write failed/);
  });
}

test("non-JSON error and network failure remain failures", async () => {
  await assert.rejects(saveStatus("11", "Evaluated", "Applied", async () => new Response("unavailable", { status: 503 })), /Could not save/);
  await assert.rejects(saveStatus("11", "Evaluated", "Applied", async () => { throw new Error("offline"); }), /offline/);
});

for (const body of [null, {}, { ok: false, status: "Applied" }, { ok: true }, { ok: true, status: "Hired" }]) {
  test(`malformed or mismatched 200 (${JSON.stringify(body)}) is not confirmation`, async () => {
    await assert.rejects(saveStatus("11", "Evaluated", "Applied", async () => Response.json(body)), /Could not confirm/);
  });
}

test("HTML 200 is not confirmation", async () => {
  await assert.rejects(saveStatus("11", "Evaluated", "Applied", async () => new Response("<html>login</html>")), /Could not confirm/);
});
