import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/home/decision-card.tsx"),
  "utf8",
);

test("Today primary action opens the report, not Mark applied", () => {
  const primary = src.indexOf('href={`/pipeline/${app.n}`}');
  const mark = src.indexOf('setStatus("Applied")');
  assert.notEqual(primary, -1);
  assert.notEqual(mark, -1);
  assert.ok(primary < mark, "report link must come before the Applied writer");
  assert.match(src, /> Review\s*</);
});

test("Applied asks before it writes", () => {
  const ask = src.indexOf('appliedWriteAllowed({ status: "Applied", confirmed: false })');
  const yes = src.indexOf('appliedWriteAllowed({ status: "Applied", confirmed: true })');
  const write = src.indexOf('void setStatus("Applied")');
  assert.ok(ask !== -1 && yes !== -1 && write !== -1);
  assert.ok(ask < yes && yes < write, "the first click asks; only the yes path writes");
  assert.match(src, /setAskApplied\(true\)/);
});
