import { test } from "node:test";
import assert from "node:assert/strict";
import { collectWhatsNew } from "../../src/lib/whats-new.mjs";

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
