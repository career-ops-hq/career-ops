import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OFFER_LIMIT,
  MAX_OFFER_LIMIT,
  collectWhatsNew,
  resolveOfferLimit,
} from "../../src/lib/whats-new.mjs";

const header = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation";
const toOffer = ([url, , , title, company]) => (url ? { url, title, company } : null);

test("count is not capped by the card payload limit", () => {
  const rows = [
    header,
    ...Array.from({ length: 30 }, (_, i) =>
      `https://example.com/${i}\t2026-08-10\ttest\tRole ${i}\tCompany ${i}\tadded\tRemote`,
    ),
  ];
  const result = collectWhatsNew(rows, {
    cutoff: Date.parse("2026-08-03"),
    toOffer,
    offerLimit: 24,
  });

  assert.equal(result.offers.length, 24);
  assert.equal(result.count, 30);
});

test("duplicate URLs count once even when walking the full history", () => {
  const rows = [
    header,
    "https://example.com/1\t2026-08-09\ttest\tOld title\tAcme\tadded\tRemote",
    "https://example.com/1\t2026-08-10\ttest\tNew title\tAcme\tadded\tRemote",
  ];
  const result = collectWhatsNew(rows, {
    cutoff: Date.parse("2026-08-03"),
    toOffer,
  });

  assert.equal(result.offers.length, 1);
  assert.equal(result.count, 1);
  assert.equal(result.offers[0].title, "New title");
});

test("legacy append-order fallback also reports the complete count", () => {
  const rows = [
    header,
    ...Array.from({ length: 15 }, (_, i) =>
      `https://example.com/legacy-${i}\t\ttest\tRole ${i}\tCompany ${i}\tadded\tRemote`,
    ),
  ];
  const result = collectWhatsNew(rows, {
    cutoff: Date.parse("2026-08-03"),
    toOffer,
    fallbackLimit: 12,
  });

  assert.equal(result.offers.length, 12);
  assert.equal(result.count, 15);
});

test("a missing or blank limit falls back to the card default", () => {
  assert.equal(resolveOfferLimit(null), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit(undefined), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit(""), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("   "), DEFAULT_OFFER_LIMIT);
});

test("the render ceiling is always finite, whatever the caller asks for", () => {
  // explorer-view has no virtualisation, so an unbounded list is an unbounded
  // DOM. The legacy `all` sentinel must degrade to a bounded default, never to
  // Infinity.
  assert.equal(resolveOfferLimit("all"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("Infinity"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("-Infinity"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("NaN"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("100000"), MAX_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("1e9"), MAX_OFFER_LIMIT);
  assert.equal(resolveOfferLimit(String(MAX_OFFER_LIMIT)), MAX_OFFER_LIMIT);
});

test("a partially numeric limit falls back instead of under-fetching", () => {
  // parseInt would read a numeric *prefix* — "24junk" as 24, "1e9" as 1 — so a
  // malformed limit would quietly become a real one (and "1e9" would return a
  // single offer, the opposite of what it asks for).
  assert.equal(resolveOfferLimit("24junk"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("200px"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("12 34"), DEFAULT_OFFER_LIMIT);
  assert.equal(resolveOfferLimit("24.7"), DEFAULT_OFFER_LIMIT);
});

test("surrounding whitespace is tolerated, not treated as malformed", () => {
  assert.equal(resolveOfferLimit(" 50 "), 50);
  assert.equal(resolveOfferLimit("\t200\n"), MAX_OFFER_LIMIT);
});

test("in-range limits pass through and degenerate ones clamp up to 1", () => {
  assert.equal(resolveOfferLimit("1"), 1);
  assert.equal(resolveOfferLimit("50"), 50);
  assert.equal(resolveOfferLimit("0"), 1);
  assert.equal(resolveOfferLimit("-10"), 1);
});

test("the Explore limit still returns the complete count", () => {
  const rows = [
    header,
    ...Array.from({ length: MAX_OFFER_LIMIT + 40 }, (_, i) =>
      `https://example.com/${i}\t2026-08-10\ttest\tRole ${i}\tCompany ${i}\tadded\tRemote`,
    ),
  ];
  const result = collectWhatsNew(rows, {
    cutoff: Date.parse("2026-08-03"),
    toOffer,
    offerLimit: resolveOfferLimit(String(MAX_OFFER_LIMIT)),
  });

  assert.equal(result.offers.length, MAX_OFFER_LIMIT);
  assert.equal(result.count, MAX_OFFER_LIMIT + 40);
});
