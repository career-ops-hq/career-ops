// Parity + regression tests for the web's Unicode-safe normalizeTextKey mirror.
// Imports the core and the web copy side-by-side so they can never drift (#2369/#2666).
//
// Run:  node --test tests/lib/normalize-text-key.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTextKey as webKey } from "../../src/lib/core/normalize-text-key.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { normalizeTextKey: coreKey } = await import(
  pathToFileURL(join(ROOT, "tracker-parse.mjs")).href
);

const CASES = [
  ["Nestlé", "nestlé"],
  ["Zürich Re", "zürich re"],
  ["Ação Digital", "ação digital"],
  ["Škoda", "škoda"],
  ["日本電産", "日本電産"],
  ["Acme, Inc.", "acme inc"],
  ["Koda", "koda"],
];

test("web mirror matches core for accented / CJK / punctuation cases", () => {
  for (const [input, expected] of CASES) {
    assert.equal(webKey(input, " "), expected, `web: ${input}`);
    assert.equal(coreKey(input, " "), expected, `core: ${input}`);
    assert.equal(webKey(input, " "), coreKey(input, " "), `parity: ${input}`);
  }
});

test("Škoda does not collide with Koda (the silent-suppression bug)", () => {
  assert.notEqual(webKey("Škoda", " "), webKey("Koda", " "));
  assert.equal(webKey("Škoda", " "), coreKey("Škoda", " "));
});

test("CJK company names stay non-empty (the forever-duplicate bug)", () => {
  assert.ok(webKey("日本電産", " "));
  assert.equal(webKey("日本電産", " "), "日本電産");
});

test("null/undefined key to empty string (not 'null'/'undefined')", () => {
  assert.equal(webKey(null, " "), "");
  assert.equal(webKey(undefined, " "), "");
  assert.equal(webKey(null, " "), coreKey(null, " "));
  assert.equal(webKey(undefined), coreKey(undefined));
});

test("default separator stays solid-key (opt-in space only)", () => {
  assert.equal(webKey("Acme, Inc."), "acmeinc");
  assert.equal(webKey("Acme, Inc."), coreKey("Acme, Inc."));
  assert.equal(webKey("Acme, Inc.", " "), "acme inc");
});

test("ASCII-only [^a-z0-9] shape must not return (regression lock)", () => {
  // The pre-#2666 web norm produced these broken keys. If anyone reintroduces
  // that regex, these assertions fail loudly.
  assert.notEqual(webKey("Nestlé", " "), "nestl");
  assert.notEqual(webKey("Zürich Re", " "), "z rich re");
  assert.notEqual(webKey("Ação Digital", " "), "a o digital");
  assert.notEqual(webKey("Škoda", " "), "koda");
  assert.notEqual(webKey("日本電産", " "), "");
});
