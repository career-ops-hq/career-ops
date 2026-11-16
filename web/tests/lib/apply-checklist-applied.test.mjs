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
  const askAt = src.indexOf("{ask && (");
  const askEnd = src.indexOf("{error &&", askAt);
  assert.ok(askAt !== -1 && askEnd > askAt);
  const confirm = src.slice(askAt, askEnd);
  assert.match(confirm, /role="alert"/);
  assert.match(confirm, /ref=\{yesRef\}/);
  assert.match(src, /yesRef\.current\?\.focus\(\)/);
});

test("Today's decision card Applied confirm takes focus and has an alert role", () => {
  const src = readFileSync(join(here, "../../src/components/home/decision-card.tsx"), "utf8");
  const askAt = src.indexOf("{askApplied && (");
  const askEnd = src.indexOf("{error &&", askAt);
  assert.ok(askAt !== -1 && askEnd > askAt);
  const confirm = src.slice(askAt, askEnd);
  assert.match(confirm, /role="alert"/);
  assert.match(confirm, /ref=\{appliedYesRef\}/);
  assert.match(src, /appliedYesRef\.current\?\.focus\(\)/);
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
  const confirmAt = src.indexOf('visibleTab !== "INBOX" && appliedAsk && appliedAsk.length > 0 &&');
  const confirmEnd = src.indexOf("bulkError", confirmAt);
  assert.ok(confirmAt !== -1 && confirmEnd > confirmAt);
  const confirm = src.slice(confirmAt, confirmEnd);
  assert.match(confirm, /role="alert"/);
  assert.match(confirm, /ref=\{appliedAskYesRef\}/);
  assert.match(src, /appliedAskYesRef\.current\?\.focus\(\)/);
  assert.match(src, /appliedPromptStale\(/);
});
