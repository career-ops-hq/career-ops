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

test("Moka fragment-routed jobs keep distinct identity in both core and web keys", () => {
  const base = "https://app.mokahr.com/social-recruitment/high-flyer/140576";
  const jobA = `${base}#/job/7dcd6fde-84f1-4deb-890c-f1f275df0efc`;
  const jobB = `${base}#/job/0cc59b14-538d-4b5c-8c82-05482810576b`;
  assert.notEqual(webKey(jobA), webKey(jobB), "two distinct Moka openings collapsed to one web dedup key");
  assert.equal(webKey(jobA), coreKey(jobA));
  assert.equal(webKey(jobB), coreKey(jobB));
});

test("fragment promotion stays limited to recognized job routes", () => {
  const base = "https://app.mokahr.com/social-recruitment/high-flyer/140576";
  const job = `${base}#/job/abc-123`;
  const cases = [
    [`${job}?view=compact`, job, "fragment query state should not change job identity"],
    [`${base}#/job/abc-123/extra`, base, "unsupported route suffix must not be promoted"],
    ["https://example.com/tenant#apply", "https://example.com/tenant", "cosmetic fragments must not be promoted"],
  ];
  for (const [input, expectedInput, message] of cases) {
    assert.equal(webKey(input), webKey(expectedInput), message);
    assert.equal(webKey(input), coreKey(input), `root/web parity: ${input}`);
  }
});

test("generic hash-route jobs keep distinct identity in both core and web keys", () => {
  const base = "https://jobs.example.com/careers";
  const jobA = `${base}#/jobs/123`;
  const jobB = `${base}#/jobs/456`;
  assert.notEqual(webKey(jobA), webKey(jobB), "two distinct hash-route openings collapsed to one web dedup key");
  assert.equal(webKey(jobA), coreKey(jobA));
  assert.equal(webKey(jobB), coreKey(jobB));
});

test("promoted fragment identity does not overwrite pre-existing internal comparison params", () => {
  const input = "https://jobs.example.com/careers?_career_ops_fragment_job_id=query-id#/jobs/hash-id";
  const expected = "https://jobs.example.com/careers?_career_ops_fragment_job_id=hash-id&_career_ops_fragment_job_id=query-id";
  assert.equal(webKey(input), expected);
  assert.equal(coreKey(input), expected);
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

test("web mirrors core normalization for a single trailing DNS root dot", () => {
  const cases = [
    ["https://jobs.example.com./role/123", "https://jobs.example.com/role/123"],
    ["http://Jobs.Example.COM./role/123?gh_jid=42&utm_source=demo", "https://jobs.example.com/role/123?gh_jid=42"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(webKey(input), expected, `web key for ${input}`);
    assert.equal(webKey(input), coreKey(input), `core/web parity for ${input}`);
  }

  // Avoid broad repairs: these spellings stay distinct from a valid host.
  const doubled = "https://jobs.example.com../role/123";
  assert.equal(webKey(doubled), coreKey(doubled));
  assert.notEqual(webKey(doubled), webKey("https://jobs.example.com/role/123"));
});

// postingLanguageKey / postingUrlRelation: the language rule What's New
// suppression compares posting URLs with (#5684). Cases are the core's own
// (tests/url-key.test.mjs, "postingLanguageKey() / postingUrlRelation()").
const {
  postingLanguageKey: coreLanguageKey,
  postingUrlRelation: coreRelation,
} = await import(pathToFileURL(join(ROOT, "url-key.mjs")).href);
const { postingLanguageKey: webLanguageKey, postingUrlRelation: webRelation } = await import(
  "../../src/lib/core/url-key.mjs"
);

test("web postingLanguageKey matches core: the language param leaves the key", () => {
  const CASES = [
    "https://acme.recruitee.com/o/qa-lead",
    "https://acme.recruitee.com/o/qa-lead?lang=de",
    "https://acme.jobs.personio.de/job/1?language=en-GB&utm_source=x",
    "https://jobs.example.com/j/1?Locale=fr_CA&id=7",
    "https://acme.recruitee.com/o/a?lang=zh-Hant",
    "https://acme.recruitee.com/o/a?lang=English%20(US)",
    "",
    "N/A",
    null,
    "local:jds/x.md",
  ];
  for (const input of CASES) {
    assert.deepEqual(webLanguageKey(input), coreLanguageKey(input), `parity: ${JSON.stringify(input)}`);
  }
  assert.deepEqual(webLanguageKey("https://acme.recruitee.com/o/qa-lead?lang=de"), {
    key: webKey("https://acme.recruitee.com/o/qa-lead"),
    language: "de",
    script: "",
  });
});

test("web postingUrlRelation matches core on every relation", () => {
  const R = "https://acme.recruitee.com/o/a";
  const U = (q) => `${R}?lang=${q}`;
  const CASES = [
    [R, "https://acme.recruitee.com/o/b", "distinct"],
    [R, "N/A", "no-key"],
    ["", R, "no-key"],
    [R, U("de"), "one-sided-language"],
    ["https://acme.jobs.personio.de/job/1?language=en", "https://acme.jobs.personio.de/job/1", "one-sided-language"],
    [U("zh-Hant"), U("zh-Hans"), "distinct"],
    [U("zh-TW"), U("zh-CN"), "distinct"],
    [U("sr-Latn"), U("sr-Cyrl"), "distinct"],
    [U("zh"), U("zh-Hant"), "same"],
    [U("de"), U("de-AT"), "same"],
    [U("pt-BR"), U("pt-PT"), "same"],
    [U("de"), U("en"), "distinct"],
    [U("en-GB"), U("en"), "same"],
    ["http://acme.recruitee.com/o/a/?utm_source=x", R, "same"],
  ];
  for (const [a, b, expected] of CASES) {
    assert.equal(webRelation(a, b), expected, `web: ${a} vs ${b}`);
    assert.equal(webRelation(a, b), coreRelation(a, b), `parity: ${a} vs ${b}`);
  }
});
