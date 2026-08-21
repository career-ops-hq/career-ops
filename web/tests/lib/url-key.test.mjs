// Parity + regression tests for the web's normalizeUrl (posting-key) mirror.
// Imports the core and the web copy side-by-side so they can never drift, same
// pattern as normalize-text-key.test.mjs (#2369/#2666).
//
// Run:  node --test tests/lib/url-key.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUrl as webKey } from "../../src/lib/core/url-key.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { normalizeUrl: coreKey } = await import(pathToFileURL(join(ROOT, "url-key.mjs")).href);

test("web mirror matches core on ordinary postings (https upgrade, hostname lowercase, trailing slash)", () => {
  const CASES = [
    "http://Boards.Greenhouse.io/acme/jobs/apply",
    "https://boards.greenhouse.io/acme/jobs/apply/",
    "https://jobs.example.com/role#applyNow",
  ];
  for (const input of CASES) {
    assert.equal(webKey(input), coreKey(input), `parity: ${input}`);
  }
});

test("web mirror strips the same tracking-param denylist as core, in the same sorted order", () => {
  const url = "https://boards.greenhouse.io/acme/jobs/apply?utm_source=li&gh_jid=4471829005&fbclid=xyz";
  assert.equal(
    webKey(url),
    "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005",
  );
  assert.equal(webKey(url), coreKey(url));
});

test("two RETAINED (non-tracking) params in opposite input order sort to the same key, on both sides", () => {
  // A single retained param (the test above) never exercises keep.sort() —
  // there is nothing to order. This pins order-independence with two.
  const orderA = "https://boards.greenhouse.io/acme/jobs/apply?location=paris&gh_jid=4471829005&utm_source=li";
  const orderB = "https://boards.greenhouse.io/acme/jobs/apply?utm_source=li&gh_jid=4471829005&location=paris";
  const expected = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005&location=paris";
  assert.equal(webKey(orderA), expected);
  assert.equal(webKey(orderB), expected, "opposite input order must sort to the identical key");
  assert.equal(webKey(orderA), coreKey(orderA));
  assert.equal(webKey(orderB), coreKey(orderB));
});

test("the reported bug: two DIFFERENT Greenhouse postings (same host+path, distinct gh_jid) key DIFFERENTLY", () => {
  const jobA = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005";
  const jobB = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=5501203417";
  assert.notEqual(webKey(jobA), webKey(jobB), "two distinct openings collapsed to one dedup key");
  assert.equal(webKey(jobA), coreKey(jobA));
  assert.equal(webKey(jobB), coreKey(jobB));
});

test("host+pathname-only shape must not return (regression lock on the pre-fix canon())", () => {
  // The pre-fix canon() discarded the ENTIRE query string, so both of these
  // collapsed to "boards.greenhouse.io/acme/jobs/apply". If that shape comes
  // back, this fails loudly.
  const jobA = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005";
  const jobB = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=5501203417";
  assert.notEqual(webKey(jobA), "boards.greenhouse.io/acme/jobs/apply");
  assert.notEqual(webKey(jobB), "boards.greenhouse.io/acme/jobs/apply");
});

test("unparseable / non-http(s) input keys to '' on both sides (NO KEY IS NOT A KEY)", () => {
  for (const bad of ["not a url", "ftp://example.com/x", "", "   "]) {
    assert.equal(webKey(bad), "", `web: ${JSON.stringify(bad)}`);
    assert.equal(coreKey(bad), "", `core: ${JSON.stringify(bad)}`);
  }
  assert.equal(webKey(null), "");
  assert.equal(webKey(undefined), "");
});
