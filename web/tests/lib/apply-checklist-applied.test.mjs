import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

test("the checklist Applied button asks before it writes", () => {
  const src = readFileSync(join(here, "../../src/components/apply-checklist.tsx"), "utf8");
  const ask = src.indexOf('appliedWriteAllowed({ status: "Applied", confirmed: false })');
  const yes = src.indexOf('appliedWriteAllowed({ status: "Applied", confirmed: true })');
  const write = src.indexOf('saveStatus(trackerNum, status, "Applied")');
  assert.ok(ask !== -1 && yes !== -1 && write !== -1);
  assert.ok(ask < yes && yes < write, "the first click asks; only the yes path writes");
  assert.match(src, /if \(!pending\.write\) setAsk\(true\)/);
});

test("pipeline Applied from a key or the bulk button asks before it writes", () => {
  const src = readFileSync(join(here, "../../src/components/pipeline-view.tsx"), "utf8");
  const gate = src.indexOf("appliedWriteAllowed({ status, confirmed })");
  const write = src.indexOf("void commitStatus(rows, status)");
  assert.ok(gate !== -1 && write !== -1 && gate < write);
  assert.match(src, /requestRef\.current\(rows, command\.status\)/);
  assert.doesNotMatch(src, /commitRef\.current\(rows, command\.status\)/);
  assert.match(src, /requestStatus\(selectedRows, bulkStatus\)/);
  assert.match(src, /requestStatus\(appliedAsk, "Applied", true\)/);
});
