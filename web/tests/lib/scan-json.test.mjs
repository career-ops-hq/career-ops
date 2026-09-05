// parseScanJsonStdout salvages scan-ats-full --json stdout when Node warnings
// prefix the object (or SIGTERM truncates a later field). JSON.parse of the
// whole buffer used to fail and Discover reported 0 offers after the live
// counter had already shown matches.
//
// Run:  node --test tests/lib/scan-json.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanJsonStdout } from "../../src/lib/core/scan-json.mjs";

const OFFER = {
  company: "Acme",
  title: "Staff Engineer",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  location: "Remote",
  postedAt: "2026-08-01",
  source: "greenhouse-full",
};

const SCAN = {
  companiesScanned: 12,
  companiesAvailable: 40,
  capHit: false,
  postingsKept: 1,
  offers: [OFFER],
};

test("a clean --json object parses", () => {
  const parsed = parseScanJsonStdout(JSON.stringify(SCAN));
  assert.deepEqual(parsed, SCAN);
});

test("a Node warning prefix does not drop the offers", () => {
  const raw = `(node:123) Warning: something\n${JSON.stringify(SCAN)}\n`;
  const parsed = parseScanJsonStdout(raw);
  assert.notEqual(parsed, null);
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0].url, OFFER.url);
});

test("trailing stderr-bleed after the closing brace still parses", () => {
  const raw = `${JSON.stringify(SCAN)}\n[scan] leftover line\n`;
  const parsed = parseScanJsonStdout(raw);
  assert.equal(parsed.offers[0].company, "Acme");
});

test("empty or non-object stdout is null, not a throw", () => {
  assert.equal(parseScanJsonStdout(""), null);
  assert.equal(parseScanJsonStdout("   "), null);
  assert.equal(parseScanJsonStdout("not json"), null);
  assert.equal(parseScanJsonStdout("[]"), null);
});

test("a truncated later field still keeps a completed offers array", () => {
  // Outer object never closed; datasetStatus was cut mid-value. offers already
  // finished, which is the SIGTERM-during-Workday case this parser exists for.
  const truncated =
    '{"offers":[' +
    JSON.stringify(OFFER) +
    '],"companiesScanned":12,"datasetStatus":{"workday":';
  const parsed = parseScanJsonStdout(truncated);
  assert.notEqual(parsed, null, "completed offers must survive a truncated tail");
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0].url, OFFER.url);
});
