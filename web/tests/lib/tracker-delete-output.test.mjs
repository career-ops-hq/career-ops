// Tests for parseOrphanReport(), which reads the report a `tracker.mjs delete`
// run leaves on disk out of the script's stderr so the confirm dialog can say
// "its report file is left on disk".
//
// The pattern it replaces matched neither line the script writes: the value is
// the tracker's Report cell, a markdown link ending in `)`, and the capture
// stopped at the first `)`; the real-delete line puts a space before its dash,
// which the pattern did not allow. The notice never showed.
//
// Run:  node --test tests/lib/tracker-delete-output.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseOrphanReport } from "../../src/lib/tracker-delete-output.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const DRY = [
  "Would remove application 42 (1 row) from /home/u/career-ops/data/applications.md.",
  "(report file would be orphaned: [42](../reports/042-beta-2026-09-02.md))",
  "",
].join("\n");

const REAL = [
  "Removed application 42 (1 row) from /home/u/career-ops/data/applications.md and reindexed.",
  "Note: report file may now be orphaned — [42](../reports/042-beta-2026-09-02.md)",
  "",
].join("\n");

test("parseOrphanReport: reads the report out of a dry-run", () => {
  assert.equal(parseOrphanReport(DRY), "reports/042-beta-2026-09-02.md");
});

test("parseOrphanReport: reads the report out of a real delete", () => {
  assert.equal(parseOrphanReport(REAL), "reports/042-beta-2026-09-02.md");
});

test("parseOrphanReport: a root-layout tracker links reports without ../", () => {
  assert.equal(
    parseOrphanReport("(report file would be orphaned: [7](reports/007-acme-2026-01-01.md))"),
    "reports/007-acme-2026-01-01.md",
  );
});

test("parseOrphanReport: a path with parentheses survives whole", () => {
  assert.equal(
    parseOrphanReport("(report file would be orphaned: [7](reports/007-acme-(emea)-2026-01-01.md))"),
    "reports/007-acme-(emea)-2026-01-01.md",
  );
  assert.equal(
    parseOrphanReport("Note: report file may now be orphaned — [7](reports/007-acme-(emea)-2026-01-01.md)"),
    "reports/007-acme-(emea)-2026-01-01.md",
  );
});

test("parseOrphanReport: a cell that is not a link is returned as written", () => {
  assert.equal(parseOrphanReport("Note: report file may now be orphaned — reports/007-acme.md"), "reports/007-acme.md");
  assert.equal(parseOrphanReport("(report file would be orphaned: 007)"), "007");
});

test("parseOrphanReport: other stderr lines around the report line do not matter", () => {
  // The script may say more before, between or after (a resync warning, a
  // backup path). Each line is judged on its own.
  const noisy = [
    "(index stale — resyncing from /home/u/career-ops/data/applications.md)",
    "Removed application 42 (1 row) from /home/u/career-ops/data/applications.md and reindexed.",
    "Some later line the script might add: /home/u/career-ops/data/applications.md.bak",
    "Note: report file may now be orphaned — [42](../reports/042-beta-2026-09-02.md)",
    "A trailing line.",
  ].join("\n");
  assert.equal(parseOrphanReport(noisy), "reports/042-beta-2026-09-02.md");
});

test("parseOrphanReport: CRLF output is read the same way", () => {
  assert.equal(parseOrphanReport(REAL.replace(/\n/g, "\r\n")), "reports/042-beta-2026-09-02.md");
});

test("parseOrphanReport: no report line means no report", () => {
  assert.equal(parseOrphanReport("Removed application 42 (1 row) from x and reindexed.\n"), null);
  assert.equal(parseOrphanReport(""), null);
  assert.equal(parseOrphanReport(undefined), null);
  // The word alone, outside either line the script writes, is not a report.
  assert.equal(parseOrphanReport("(row removed; index resync skipped: orphaned: handle)"), null);
});

test("tracker.mjs still writes the two lines this parser reads", () => {
  // The parser and the script are in different packages, so nothing else ties
  // them together: a reworded message would silently hide the notice again.
  const script = readFileSync(join(HERE, "..", "..", "..", "tracker.mjs"), "utf-8");
  assert.ok(script.includes("`(report file would be orphaned: ${report})`"), "dry-run line changed in tracker.mjs");
  assert.ok(script.includes("`Note: report file may now be orphaned — ${report}`"), "real-delete line changed in tracker.mjs");
});
