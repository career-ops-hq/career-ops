// /api/explore/ai drops offers the user already has before they leave the
// server (makeKnownOfferFilter), instead of sending every URL in scan history
// to the browser for the client parser to check.
//
// Run:  node --test tests/lib/explore-known-offer-filter.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeKnownOfferFilter, makeAiStreamParser, canon } from "../../src/lib/explore-ai.ts";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const envelope = (offer) => `<<offer:${JSON.stringify(offer)}>>`;
const KNOWN = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005";
const NEW = "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=9999999999";

test("a known offer is dropped and everything else passes through unchanged", () => {
  const filter = makeKnownOfferFilter(new Set([canon(KNOWN)]));
  const text = `Searching boards…\n${envelope({ url: KNOWN, company: "Acme", title: "Old" })}\nand ${envelope({ url: NEW, company: "Acme", title: "New" })} done.`;
  const out = filter.feed(text) + filter.flush();
  assert.equal(out, `Searching boards…\n\nand ${envelope({ url: NEW, company: "Acme", title: "New" })} done.`);
});

test("the key is the client parser's: a tracking param on a known URL is still known", () => {
  const filter = makeKnownOfferFilter(new Set([canon(KNOWN)]));
  const out = filter.feed(envelope({ url: `${KNOWN}&utm_source=x`, company: "Acme", title: "Old" })) + filter.flush();
  assert.equal(out, "");
});

test("envelopes and openers split across chunks are reassembled before deciding", () => {
  const filter = makeKnownOfferFilter(new Set([canon(KNOWN)]));
  const text = `a ${envelope({ url: KNOWN, title: "Old" })} b ${envelope({ url: NEW, title: "New" })} c`;
  let out = "";
  for (const ch of text) out += filter.feed(ch); // one character at a time
  out += filter.flush();
  assert.equal(out, `a  b ${envelope({ url: NEW, title: "New" })} c`);
});

test("a malformed envelope passes through for the client to report", () => {
  const filter = makeKnownOfferFilter(new Set([canon(KNOWN)]));
  const out = filter.feed("<<offer:{not json>> tail") + filter.flush();
  assert.equal(out, "<<offer:{not json>> tail");
  const chunks = makeAiStreamParser().feed(out);
  assert.equal(chunks.some((c) => c.kind === "malformed"), true);
});

test("the client parser sees exactly the new offer after the server filter", () => {
  const filter = makeKnownOfferFilter(new Set([canon(KNOWN)]));
  const parser = makeAiStreamParser();
  const chunks = parser.feed(filter.feed(envelope({ url: KNOWN, title: "Old" }) + envelope({ url: NEW, title: "New" })) + filter.flush());
  const offers = chunks.filter((c) => c.kind === "offer");
  assert.deepEqual(offers.map((c) => c.offer.url), [NEW]);
});

test("the known-URL list is no longer served to the browser", () => {
  assert.equal(existsSync(join(webRoot, "src/app/api/explore/ai/known/route.ts")), false, "GET /api/explore/ai/known still exists");
  const provider = readFileSync(join(webRoot, "src/components/explore/explore-provider.tsx"), "utf8");
  assert.doesNotMatch(provider, /\/api\/explore\/ai\/known/);
  const route = readFileSync(join(webRoot, "src/app/api/explore/ai/route.ts"), "utf8");
  assert.match(route, /makeKnownOfferFilter\(/);
});

test("AI Explore excludes an existing job when the proposed hostname has a DNS root dot", () => {
  const saved = "https://jobs.example.com/role/123";
  const dotted = "https://jobs.example.com./role/123";
  const different = "https://jobs.example.com./role/124";

  const filter = makeKnownOfferFilter(new Set([canon(saved)]));
  const duplicateEnvelope = envelope({ url: dotted, company: "Example Co", title: "Software Engineer" });
  const differentEnvelope = envelope({ url: different, company: "Example Co", title: "Data Engineer" });
  const output = filter.feed(duplicateEnvelope + differentEnvelope) + filter.flush();

  assert.equal(output, differentEnvelope, "known job must be removed without hiding a distinct opening");
});
