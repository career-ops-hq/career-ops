// Executes the REAL makeAiStreamParser / canon() from explore-ai.ts — the file
// has no `@/` alias imports and no Node-only deps ("Client-safe (NO node
// imports)" per its own header), so unlike pipeline.ts it can be imported
// directly here rather than needing source-text extraction.
//
// Covers the silent-drop bug: canon() used to key on host+pathname only,
// discarding the query string, so two DIFFERENT Greenhouse postings sharing a
// path (distinct only by `?gh_jid=`) collapsed onto one dedup key and every
// opening after the first was silently absent from AI Discover results.
//
// Run:  node --test tests/lib/explore-ai-dedup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAiStreamParser, canon } from "../../src/lib/explore-ai.ts";

const envelope = (offer) => `<<offer:${JSON.stringify(offer)}>>`;

test("two distinct postings that share host+path but differ by a functional query id are BOTH kept", () => {
  const parser = makeAiStreamParser();
  const jobA = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005";
  const jobB = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=5501203417";
  const chunks = [
    ...parser.feed(envelope({ url: jobA, company: "Acme", title: "Backend Engineer" })),
    ...parser.feed(envelope({ url: jobB, company: "Acme", title: "Frontend Engineer" })),
  ];
  const offers = chunks.filter((c) => c.kind === "offer");
  assert.equal(offers.length, 2, "the second, genuinely different posting was silently dropped");
  assert.equal(offers[0].offer.url, jobA);
  assert.equal(offers[1].offer.url, jobB);
});

test("a TRUE duplicate (same posting, tracking param added) is still deduped within a run", () => {
  const parser = makeAiStreamParser();
  const base = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005";
  const tracked = base + "&utm_source=linkedin";
  const chunks = [
    ...parser.feed(envelope({ url: base, company: "Acme", title: "Backend Engineer" })),
    ...parser.feed(envelope({ url: tracked, company: "Acme", title: "Backend Engineer" })),
  ];
  const offers = chunks.filter((c) => c.kind === "offer");
  assert.equal(offers.length, 1, "the same posting with a tracking param appended should dedup, not double-post");
});

test("knownUrls filters an already-seen posting by its exact gh_jid, not by host+path alone", () => {
  const known = new Set([canon("https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005")]);
  const parser = makeAiStreamParser({ knownUrls: known });
  const sameJob = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005";
  const differentJob = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=9999999999";
  const chunks = [
    ...parser.feed(envelope({ url: sameJob, company: "Acme", title: "Already known" })),
    ...parser.feed(envelope({ url: differentJob, company: "Acme", title: "New opening" })),
  ];
  const offers = chunks.filter((c) => c.kind === "offer");
  assert.equal(offers.length, 1, "a genuinely new posting at the same host+path was filtered as if already known");
  assert.equal(offers[0].offer.url, differentJob);
});

test("two scheme-valid but URL-unparseable offers BOTH survive — an empty key must not dedup against itself", () => {
  // Both pass toOffer()'s /^https?:\/\// gate (so they reach canon()) but throw
  // in `new URL(...)`, so canon() returns '' for each. Without the `key &&`
  // guard, the second offer's '' would match the first's '' in `seen` and get
  // silently dropped — two UNRELATED malformed entries treated as duplicates
  // of each other purely because neither could be keyed.
  const parser = makeAiStreamParser();
  const unparseableA = "https://[bad";
  const unparseableB = "http:// space.example.com";
  assert.equal(canon(unparseableA), "", "test premise: A must canonicalize to the empty key");
  assert.equal(canon(unparseableB), "", "test premise: B must canonicalize to the empty key");
  const chunks = [
    ...parser.feed(envelope({ url: unparseableA, company: "Acme", title: "Role A" })),
    ...parser.feed(envelope({ url: unparseableB, company: "Acme", title: "Role B" })),
  ];
  const offers = chunks.filter((c) => c.kind === "offer");
  assert.equal(offers.length, 2, "an empty canonical key deduped against another empty key");
  assert.equal(offers[0].offer.url, unparseableA);
  assert.equal(offers[1].offer.url, unparseableB);
});
