import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestRequest } from "../../src/lib/latest-request.mjs";

// Follow-up to #6435: the Documents page refetches after every finished job.
// Two fetches can overlap, and the other open tabs never heard the event.

test("an older response that lands after a newer one is ignored", () => {
  const gate = createLatestRequest();
  const older = gate.start();
  const newer = gate.start();
  assert.equal(gate.isLatest(newer), true);
  assert.equal(gate.isLatest(older), false);
});

test("cancel drops every ticket handed out so far", () => {
  const gate = createLatestRequest();
  const ticket = gate.start();
  gate.cancel();
  assert.equal(gate.isLatest(ticket), false);
  assert.equal(gate.isLatest(gate.start()), true);
});

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/app/documents/page.tsx"),
  "utf8",
);

test("every result path of the Documents fetch checks it is still the latest", () => {
  const fetchBlock = src.slice(src.indexOf("const refetch = useCallback"), src.indexOf("}, []);"));
  for (const step of ["setDocuments(data)", "setError(err.message", "setLoading(false)"]) {
    const at = fetchBlock.indexOf(step);
    assert.notEqual(at, -1, `${step} is in the fetch`);
    const before = fetchBlock.slice(Math.max(0, fetchBlock.lastIndexOf("=>", at)), at);
    assert.match(before, /isLatest\(ticket\)/, `${step} is guarded by isLatest(ticket)`);
  }
});

test("the Documents page refetches when its tab becomes visible again", () => {
  assert.match(src, /addEventListener\("visibilitychange", onVisible\)/);
  assert.match(src, /removeEventListener\("visibilitychange", onVisible\)/);
  assert.match(src, /visibilityState === "visible"/);
});
