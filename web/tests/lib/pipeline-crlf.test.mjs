// Regression: a CRLF `data/pipeline.md` must parse identically to an LF one.
//
// The inbox reader used to `split("\n")` and match rows with a `$`-anchored
// regex. On a CRLF file every line kept a trailing "\r", which `.+$` can never
// match (JS `.` excludes line terminators), so readInbox() returned [] and
// GET /api/pipeline reported an empty inbox — silently, with no error and with
// applications still parsing fine (that reader trims each line). `data/` is
// gitignored, so the repo's `eol=lf` .gitattributes policy does not protect the
// user's own pipeline.md from a CRLF writer on Windows.
//
// Run:  node --test tests/lib/pipeline-crlf.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInbox, splitLines } from "../../src/lib/pipeline-table.mjs";

const PIPELINE_LF = [
  "# Pipeline — Pending URLs",
  "",
  "## Pending",
  "",
  "- [ ] https://example.com/a | Acme | Backend Engineer",
  "- [ ] https://example.com/b | Globex | Data Analyst | Berlin | €70k | posted: 2026-08-01",
  "- [x] https://example.com/c | Initech | SRE | Remote",
  "",
].join("\n");

test("CRLF pipeline.md parses to the same rows as LF", () => {
  const lf = parseInbox(PIPELINE_LF);
  const crlf = parseInbox(PIPELINE_LF.replace(/\n/g, "\r\n"));
  assert.equal(lf.length, 3, "fixture sanity: three checkbox rows");
  assert.deepEqual(crlf, lf);
});

test("no field carries a stray carriage return", () => {
  for (const job of parseInbox(PIPELINE_LF.replace(/\n/g, "\r\n"))) {
    for (const [k, v] of Object.entries(job)) {
      if (typeof v === "string") assert.ok(!v.includes("\r"), `${k} kept a \r: ${JSON.stringify(v)}`);
    }
  }
});

test("mixed endings parse — an LF-written row appended to a CRLF file", () => {
  // scan.mjs's appendToPipeline writes "\n", so appending to a CRLF file leaves
  // mixed endings. Against the old reader that surfaced ONLY the appended rows.
  const mixed = PIPELINE_LF.replace(/\n/g, "\r\n") + "- [ ] https://example.com/d | Umbrella | QA\n";
  const rows = parseInbox(mixed);
  assert.equal(rows.length, 4);
  assert.equal(rows[3].company, "Umbrella");
});

test("row fields survive CRLF: last column and labels are not truncated", () => {
  const rows = parseInbox(PIPELINE_LF.replace(/\n/g, "\r\n"));
  assert.equal(rows[0].role, "Backend Engineer"); // 3-column row, last cell
  assert.equal(rows[1].compensation, "€70k"); // 5th column (#1017)
  assert.equal(rows[1].postedAt, "2026-08-01"); // labeled segment
  assert.equal(rows[2].done, true);
  assert.equal(rows[2].location, "Remote"); // 4th column (#1015)
});

test("splitLines handles LF, CRLF and a lone CR-less tail", () => {
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b", ""]);
  assert.deepEqual(splitLines("a\r\nb\r\n"), ["a", "b", ""]);
  assert.deepEqual(splitLines("a\r\nb"), ["a", "b"]);
  assert.deepEqual(splitLines(""), [""]);
});
