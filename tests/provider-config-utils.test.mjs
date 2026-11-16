// tests/provider-config-utils.test.mjs — intInRange is the only guard between a
// hand-edited portals.yml and a provider's outbound query.
//
// It was the one file under providers/ that no test referenced (89 others are
// covered), and three providers depend on it for exactly the values that decide
// whether a scan works at all:
//
//   vdab.mjs:98-101            days 1..1000, size 1..100, detailLimit 1..100
//   mycareersfuture.mjs:69,72  size 1..MAX_PAGE_SIZE, maxPages 1..MAX_PAGES_CAP
//   smartrecruiters.mjs:38     detailLimit 1..100
//
// Its own docstring states the stake: a stray value "can't produce an empty
// (e.g. size=0) or pathological query". A silent `size: 0` returns nothing and
// reads as "this board has no jobs"; a silent `maxPages: 100000` is a very long
// sweep against someone else's API. Neither errors.
//
// Run:  node --test tests/provider-config-utils.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { intInRange } = await import(pathToFileURL(join(ROOT, 'providers', '_config-utils.mjs')).href);

test('a value inside the range is returned unchanged', () => {
  assert.equal(intInRange(50, 100, 1, 100), 50);
  assert.equal(intInRange(1, 100, 1, 100), 1, 'the lower bound is inclusive');
  assert.equal(intInRange(100, 100, 1, 100), 100, 'the upper bound is inclusive');
});

test('out-of-range values are clamped, not rejected', () => {
  // Clamping rather than throwing is the deliberate choice: a portals.yml typo
  // should degrade one board's query, not abort a sweep across all of them.
  assert.equal(intInRange(0, 100, 1, 100), 1, 'size=0 must not survive — it returns an empty result set');
  assert.equal(intInRange(-5, 100, 1, 100), 1);
  assert.equal(intInRange(999999, 100, 1, 100), 100, 'an unbounded page count must not reach someone else\'s API');
});

test('a value Number() cannot read falls back to the default', () => {
  // The docstring's promise, exactly: "falling back to `def` for NaN".
  for (const bad of [undefined, 'many', 'abc', NaN, {}]) {
    assert.equal(intInRange(bad, 42, 1, 100), 42, `${JSON.stringify(String(bad))} did not fall back to the default`);
  }
});

test('a value Number() reads as 0 takes the MINIMUM, not the default', () => {
  // Documenting real behaviour, which is not what the parameter name suggests.
  // Number(null), Number('') and Number([]) are all 0 — not NaN — so these miss
  // the NaN fallback and are clamped by the lower bound instead:
  //
  //     size:            # an empty YAML key -> null -> 0 -> size = 1
  //
  // One result per page rather than the default 100. The scan still runs, so
  // nothing errors; it is just 100x the requests. That is arguably the
  // "pathological query" this function exists to prevent, arrived at from the
  // other side, but changing it would change three providers' behaviour on
  // existing configs — so it is pinned here and raised in the PR rather than
  // altered in a test-only change.
  for (const zeroish of [null, '', []]) {
    assert.equal(
      intInRange(zeroish, 42, 1, 100), 1,
      `${JSON.stringify(zeroish)} no longer clamps to the minimum — if this is now the default, the change is intended and this test should say so`,
    );
  }
  assert.equal(intInRange(true, 42, 1, 100), 1, 'Number(true) is 1, which is in range');
});

test('a numeric string is accepted — YAML quotes numbers more often than not', () => {
  assert.equal(intInRange('50', 100, 1, 100), 50);
  assert.equal(intInRange('0', 100, 1, 100), 1, 'a quoted zero is clamped like a bare one');
});

test('a fractional value is truncated toward zero, then clamped', () => {
  // Order matters: truncating 0.9 to 0 and returning it would reintroduce the
  // empty-query case the clamp exists to prevent.
  assert.equal(intInRange(9.9, 100, 1, 100), 9);
  assert.equal(intInRange(0.9, 100, 1, 100), 1, 'truncation must not slip a 0 past the lower bound');
  assert.equal(intInRange(-0.9, 100, 1, 100), 1);
});

test('Infinity is not a page count', () => {
  // Number('Infinity') is finite:false, so this rides the default path — worth
  // pinning, because a clamp that let it through would be an unbounded sweep.
  assert.equal(intInRange(Infinity, 42, 1, 100), 42);
  assert.equal(intInRange(-Infinity, 42, 1, 100), 42);
});

test('the real caller bounds hold', () => {
  // Sampled from the three importers rather than invented, so this reddens if a
  // provider widens a bound without thinking about the empty/pathological ends.
  assert.equal(intInRange(0, 30, 1, 1000), 1, 'vdab days');
  assert.equal(intInRange(5000, 100, 1, 100), 100, 'vdab size');
  assert.equal(intInRange('none', 25, 1, 100), 25, 'smartrecruiters detailLimit');
});
