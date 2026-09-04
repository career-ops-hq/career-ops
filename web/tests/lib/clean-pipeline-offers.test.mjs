// Tests for cleanPipelineOffers — the validation/canonicalization step
// pipeline.ts's addOffersToPipeline runs before handing offers to the core's
// appendToPipeline/appendToScanHistory writers.
//
// This is the durable-write half of the posting-identity fix: data/pipeline.md
// is read back into the inbox and used as a dedupe key by every launch site, so
// a URL written raw (tracking params and all) would keep splitting one posting's
// identity across the tracker and a freshly-launched evaluate worker's canonical
// job.input. This module is the guard against that regression.
//
// Run:  node --test tests/lib/clean-pipeline-offers.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPipelineOffers } from "../../src/lib/core/clean-pipeline-offers.mjs";

test("cleanPipelineOffers: canonicalizes a URL carrying tracking noise", () => {
  // Given a LinkedIn offer as a discovery card or paste dialog might hand it,
  // still carrying the share-sheet tracking parameter
  const out = cleanPipelineOffers([
    { url: "https://www.linkedin.com/jobs/view/4434693435/?trk=public_jobs", company: "Acme", title: "AI Engineer", location: "Remote", source: "linkedin" },
  ]);

  // Then the written url is the canonical one — the same string a freshly
  // launched evaluate worker's job.input will carry — not the raw paste
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://www.linkedin.com/jobs/view/4434693435/");
  assert.equal(out[0].company, "Acme");
});

test("cleanPipelineOffers: drops an offer whose url does not normalize, keeps the rest", () => {
  // Given one offer with a bogus url and two valid ones
  const out = cleanPipelineOffers([
    { url: "not a url", company: "Bad", title: "x", location: "" },
    { url: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme", title: "Engineer", location: "" },
    { url: "javascript:alert(1)", company: "Evil", title: "x", location: "" },
    { url: "https://jobs.lever.co/stripe-inc/abc", company: "Stripe", title: "Engineer", location: "" },
  ]);

  // Then only the two normalizable postings survive, in order — nothing is
  // written to pipeline.md raw, and nothing valid is silently lost either
  assert.equal(out.length, 2);
  assert.equal(out[0].company, "Acme");
  assert.equal(out[1].company, "Stripe");
});

test("cleanPipelineOffers: an offer with no url (or a non-string url) is dropped, not thrown", () => {
  const out = cleanPipelineOffers([{ company: "NoUrl", title: "x", location: "" }, { url: 42, company: "NumUrl", title: "x", location: "" }, null, undefined]);
  assert.equal(out.length, 0);
});

test("cleanPipelineOffers: defaults company/title/location/note to empty string, source falls back to ats then 'explorer'", () => {
  const out = cleanPipelineOffers([
    { url: "https://boards.greenhouse.io/acme/jobs/1" },
    { url: "https://boards.greenhouse.io/acme/jobs/2", ats: "greenhouse" },
    { url: "https://boards.greenhouse.io/acme/jobs/3", source: "scan" },
  ]);

  assert.deepEqual(out[0], { url: "https://boards.greenhouse.io/acme/jobs/1", company: "", title: "", location: "", source: "explorer", note: "" });
  assert.equal(out[1].source, "greenhouse");
  assert.equal(out[2].source, "scan");
});

test("cleanPipelineOffers: an empty or missing list yields an empty list", () => {
  assert.deepEqual(cleanPipelineOffers([]), []);
  assert.deepEqual(cleanPipelineOffers(undefined), []);
});

// ── pasted / uploaded JDs ────────────────────────────────────────────────────
//
// "Add to inbox" also accepts a posting with no URL: a JD the user pasted or
// uploaded, archived under jds/ and identified by a `local:jds/…` reference
// (see jd-source.mjs). The reference has to reach data/pipeline.md intact — a
// dropped one is a silent added:0 with a JD sitting on disk that nothing points
// at, and a MANGLED one is worse, because the row parses and then resolves to
// no file.

test("cleanPipelineOffers: passes a local:jds/ reference through untouched", () => {
  // Given a JD the user pasted, as the Add job dialog hands it over
  const out = cleanPipelineOffers([
    { url: "local:jds/acme-ai-engineer-1a2b3c4d5e.md", company: "Acme", title: "AI Engineer", source: "pasted-jd" },
  ]);

  // Then the reference survives byte for byte. It is already canonical (its
  // filename is a hash of the JD's own text), so there is nothing to normalize
  // and everything to lose by trying.
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "local:jds/acme-ai-engineer-1a2b3c4d5e.md");
  assert.equal(out[0].company, "Acme");
  assert.equal(out[0].title, "AI Engineer");
  assert.equal(out[0].source, "pasted-jd");
});

test("cleanPipelineOffers: a JD reference defaults its optional fields like any other offer", () => {
  const out = cleanPipelineOffers([{ url: "local:jds/pasted-0011223344.md" }]);
  assert.deepEqual(out[0], { url: "local:jds/pasted-0011223344.md", company: "", title: "", location: "", source: "pasted-jd", note: "" });
});

test("cleanPipelineOffers: a malformed local: reference is DROPPED, not written", () => {
  // Given strings that look like a JD reference but are not one: a traversal
  // attempt, a nested path, a non-.md file. Each would be joined onto a
  // filesystem path by /api/run if it reached pipeline.md.
  const out = cleanPipelineOffers([
    { url: "local:jds/../cv.md", company: "Bad" },
    { url: "local:jds/sub/dir.md", company: "Bad" },
    { url: "local:jds/notes.txt", company: "Bad" },
    { url: "local:reports/001.md", company: "Bad" },
    { url: "local:jds/", company: "Bad" },
  ]);

  // Then none of them is written, and none is silently rewritten into something
  // that would pass — the same all-or-nothing rule a bad URL already gets
  assert.deepEqual(out, []);
});

test("cleanPipelineOffers: JD references and URLs mix in one batch, order preserved", () => {
  const out = cleanPipelineOffers([
    { url: "https://boards.greenhouse.io/acme/jobs/1?utm_source=x", company: "Acme" },
    { url: "local:jds/stripe-backend-abcdef0123.md", company: "Stripe" },
    { url: "nonsense", company: "Dropped" },
  ]);

  assert.equal(out.length, 2);
  assert.equal(out[0].url, "https://boards.greenhouse.io/acme/jobs/1");
  assert.equal(out[1].url, "local:jds/stripe-backend-abcdef0123.md");
});
