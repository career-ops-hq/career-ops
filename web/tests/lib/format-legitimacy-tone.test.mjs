// legitimacyTone picks the report's legitimacy badge colour from the Block G
// tier in the header. Reports carry the tier in the language their evaluation
// mode writes it in, so each locale's tier names need their own case here.
//
// Run:  node --experimental-strip-types --test tests/lib/format-legitimacy-tone.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const { legitimacyTone } = await import("../../src/lib/format.ts");

test("legitimacyTone: English tiers", () => {
  assert.equal(legitimacyTone("High Confidence"), "good");
  assert.equal(legitimacyTone("Proceed with Caution"), "warn");
  assert.equal(legitimacyTone("Suspicious"), "bad");
});

test("legitimacyTone: Turkish tiers (modes/tr/is-ilani.md)", () => {
  assert.equal(legitimacyTone("Güvenilir"), "good");
  assert.equal(legitimacyTone("Dikkatli İlerle"), "warn");
  assert.equal(legitimacyTone("Şüpheli"), "bad");
});

test("legitimacyTone: an unknown tier stays muted", () => {
  assert.equal(legitimacyTone("unknown"), "muted");
});
