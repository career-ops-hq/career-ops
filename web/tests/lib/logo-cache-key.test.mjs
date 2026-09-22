// Cache-key tests for the company logo proxy (/api/logo).
//
// The on-disk logo cache is permanent — a hit and a miss are both written once
// and never revalidated — so the key carries the whole burden of correctness:
// it must fold brand-name variants together, must never fold two different
// companies together, and must change whenever candidate generation changes.
//
// Run:  node --test tests/lib/logo-cache-key.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANY_KEY_VERSION, companyCacheKey } from "../../src/lib/core/logo-cache-key.mjs";

test("punctuation, case and spacing variants of one brand share a key", () => {
  const variants = ["Acme, Inc.", "acme inc", "ACME   Inc", "A.C.M.E. Inc!"];
  const keys = new Set(variants.map(companyCacheKey));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(", ")}`);
});

test("distinct companies sharing their first 40 characters do not collide", () => {
  // Both normalize to the same 40-character prefix; only the digest separates
  // them. This is the truncation collision the digest exists to prevent.
  const a = "International Business Machines Corporation Holdings Alpha";
  const b = "International Business Machines Corporation Holdings Beta";
  assert.notEqual(companyCacheKey(a), companyCacheKey(b));
});

test("different companies get different keys", () => {
  assert.notEqual(companyCacheKey("Notion"), companyCacheKey("Zoom"));
});

test("keys are stable across calls", () => {
  assert.equal(companyCacheKey("Amazon.com Services LLC"), companyCacheKey("Amazon.com Services LLC"));
});

test("names with no alphanumeric content are rejected", () => {
  for (const bad of ["", "   ", "---", "!!!", null, undefined]) {
    assert.equal(companyCacheKey(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("keys are filesystem-safe and cannot escape the cache directory", () => {
  // A company name arrives from tracker data, so it is untrusted as a path
  // component. The NUL case is written as an escape, never embedded: a raw NUL
  // makes this file binary to grep and every future search of it silently
  // returns nothing (tests/source-no-nul-bytes.test.mjs).
  //
  // The prefix allows Unicode letters/marks/numbers (\p{L}\p{M}\p{N}), not
  // [a-z0-9] only — normalizeTextKey KEEPS non-ASCII letters AND combining
  // marks on purpose (the collision fix below; a Devanagari name like कंपनी
  // is letters plus marks, not letters alone, so \p{M} must be included or a
  // legitimate name is rejected as "unsafe"). Safety here doesn't come from
  // ASCII-only output; it comes from \p{L}\p{M}\p{N} excluding every
  // traversal/separator/control character (`.`, `/`, `\`, space, NUL)
  // regardless of script.
  const hostile =["../../etc/passwd", "..\\..\\windows\\system32", "a/b/c", "x y", "x\u0000y", "café/../../root", "कंपनी/../../root"];
  for (const name of hostile) {
    const key = companyCacheKey(name);
    if (key === null) continue;
    assert.match(key, /^co_v\d+_[\p{L}\p{M}\p{N}]{1,40}_[0-9a-f]{10}$/u, `unsafe key for ${JSON.stringify(name)}: ${key}`);
  }
});

test("the version prefix is part of every key", () => {
  assert.match(COMPANY_KEY_VERSION, /^v\d+$/);
  assert.ok(companyCacheKey("Notion").startsWith(`co_${COMPANY_KEY_VERSION}_`));
});

test("bumping the version changes every key", () => {
  // Guards the invalidation contract: entries cached under an older resolver
  // must become unreachable, not merely stale. If this ever fails, a candidate
  // generation fix would be invisible on any machine with a warm cache.
  const key = companyCacheKey("Notion");
  assert.ok(!key.includes("_v0_"), "keys must not carry a stale version token");
  assert.equal(key.split("_")[1], COMPANY_KEY_VERSION);
});

test("Škoda and Koda do not collide (the [^a-z0-9] regression this fix stops)", () => {
  // Pre-fix: both stripped to "koda" and hashed identically — one company
  // silently wore the other's logo forever, with no expiry to correct it
  // (requirement 2 in this file's own header).
  const a = companyCacheKey("Škoda");
  const b = companyCacheKey("Koda");
  // notEqual(null, "key") also passes, which would hide a DIFFERENT
  // regression — one side wrongly becoming uncacheable — as if it were this
  // test's collision guarantee holding. Both sides must be real keys first.
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(a, b);
});

test("Zürich Re and a plain-ASCII near-miss do not collide", () => {
  const a = companyCacheKey("Zürich Re");
  const b = companyCacheKey("Zurich Re");
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(a, b);
});

test("CJK company names are cacheable, not rejected as empty", () => {
  // Pre-fix: [^a-z0-9] erased CJK entirely, so companyCacheKey returned null
  // and the name was never cached — silently ineligible, not merely slower.
  const key = companyCacheKey("日本電産");
  assert.notEqual(key, null);
  assert.match(key, /^co_v\d+_日本電産_[0-9a-f]{10}$/);
});

test("two distinct CJK companies get distinct keys", () => {
  const a = companyCacheKey("日本電産");
  const b = companyCacheKey("本田技研工業");
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(a, b);
});

test("a non-BMP letter landing on the 40-char truncation boundary does not split its surrogate pair", () => {
  // CJK Extension B is astral-plane (surrogate pair in UTF-16), and real Han
  // characters live there. String.prototype.slice(0, 40) counts UTF-16 code
  // UNITS, so it can cut a pair in half and leave a lone surrogate — an
  // invalid string, not a printable one. Built to land exactly on the
  // boundary: 39 ASCII letters, then the astral letter at position 40.
  const astralLetter = "\u{20000}"; // 𠀀 — CJK Extension B, \p{L}
  const name = "a".repeat(39) + astralLetter + "trailing text past the cut";
  const key = companyCacheKey(name);
  assert.notEqual(key, null);
  // A lone (unpaired) surrogate anywhere in the key means the pair was split.
  assert.doesNotMatch(
    key,
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    `key contains an unpaired surrogate: ${JSON.stringify(key)}`,
  );
  // The astral letter must survive whole, not be silently dropped either.
  assert.ok(key.includes(astralLetter), `astral letter was lost, not just split: ${JSON.stringify(key)}`);
  assert.match(key, /^co_v\d+_[\p{L}\p{M}\p{N}]{1,40}_[0-9a-f]{10}$/u);
});
