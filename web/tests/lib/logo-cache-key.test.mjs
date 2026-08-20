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
  const hostile = ["../../etc/passwd", "..\\..\\windows\\system32", "a/b/c", "x y", "x\u0000y", "café/../../root"];
  for (const name of hostile) {
    const key = companyCacheKey(name);
    if (key === null) continue;
    assert.match(key, /^co_v\d+_[a-z0-9]{1,40}_[0-9a-f]{10}$/, `unsafe key for ${JSON.stringify(name)}: ${key}`);
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
