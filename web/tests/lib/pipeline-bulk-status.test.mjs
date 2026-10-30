import assert from "node:assert/strict";
import { test } from "node:test";
import { saveStatuses } from "../../src/lib/pipeline-status.mjs";

const rows = [
  { n: "3", status: "Evaluated" },
  { n: "4", status: "Applied" },
  { n: "5", status: "Evaluated" },
  { n: "6", status: "Evaluated" },
];

test("bulk save posts one row at a time, skips rows already there, and keeps going past a failure", async () => {
  const calls = [];
  let inFlight = 0;
  const request = async (_url, init) => {
    const { n, status } = JSON.parse(init.body);
    inFlight += 1;
    assert.equal(inFlight, 1);
    calls.push(n);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    if (n === "5") return new Response(JSON.stringify({ error: "Tracker is busy" }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, status }), { status: 200 });
  };
  const result = await saveStatuses(rows, "Applied", request);
  assert.deepEqual(calls, ["3", "5", "6"]);
  assert.deepEqual(result, { saved: ["3", "6"], failed: [{ n: "5", error: "Tracker is busy" }] });
});
