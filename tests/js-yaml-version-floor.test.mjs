// tests/js-yaml-version-floor.test.mjs — no manifest may declare a js-yaml range
// that admits a version with a known advisory.
//
// js-yaml has had two HIGH advisories fixed inside the 4.x line:
//   GHSA-52cp-r559-cp3m  fixed in 4.3.0
//   CVE-2026-59870 / GHSA-5p4m-2wfm-xmqj (quadratic CPU in !!omap resolution)
//                        fixed in 4.3.1
// So 4.3.1 is the lowest version carrying both fixes, and any range whose lowest
// satisfying version is below it is a declaration that a vulnerable version is
// acceptable.
//
// The lower bound of the range IS the guarantee, and it is easy to believe
// otherwise. `^4.3.0` reads as "4.3.0 and its security patches" but it literally
// permits 4.3.0, the version the second advisory was filed against. The root
// package-lock.json is gitignored, so nothing else holds the line: a fresh
// install (CI) resolves the newest 4.x and looks fine, while a developer checkout
// whose lockfile already pins the vulnerable version stays there — `npm install`
// reports success and changes nothing, because the pinned version satisfies the
// declared range. That is not hypothetical; it is how this was found.
//
// Manifests are DISCOVERED, not listed. A hardcoded pair holds only until the
// next workspace is added, and the failure is silent: the new manifest simply is
// not checked. `git ls-files` is the set that ships, needs no skip-list, and
// cannot wander into untracked scratch (a killed test-all.mjs run leaves a
// `.tmp-script-test-*` copy of the whole repo behind).
//
// KNOWN LIMIT — this checks the declared range, not what a lockfile resolved to.
// The two answer different questions: the range is the project's standing claim
// about what is acceptable, a lockfile is one snapshot of one resolution. A range
// that excludes the vulnerable versions makes every future resolution safe, which
// is the durable half.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, relative, basename } from 'path';

console.log('\njs-yaml must never be declared with a range admitting a known-vulnerable version');

const JS_YAML_FLOOR = [4, 3, 1];
const FLOOR_TEXT = JS_YAML_FLOOR.join('.');

/**
 * @returns {{files: string[], error: string|null}} every tracked package.json.
 * The error is returned rather than thrown: an uncaught throw here kills the
 * process before the reporting below runs, so a missing git or a ROOT that is
 * not a work tree would surface as a crash instead of a counted failure. Every
 * other way this sweep can cover nothing is reported through fail(); this one
 * has to be too, or the fail-closed guarantee has a hole exactly where the
 * discovery step is.
 */
function manifests() {
  try {
    // -z: NUL-separated, so a path containing a newline or quote cannot split a
    // record and silently drop a manifest from the sweep.
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '*package.json'], {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const files = out
      .split('\0')
      .filter((p) => p && basename(p) === 'package.json')
      .map((p) => join(ROOT, p));
    return { files, error: null };
  } catch (err) {
    return { files: [], error: err.message.split('\n')[0] };
  }
}

// Lowest version a range can resolve to, for the range shapes this repo uses.
// Returns null for anything else — a range we cannot read is reported, never
// assumed safe, because "unrecognized" and "fine" must not look the same.
function rangeMinimum(range) {
  const m = /^(?:\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(String(range ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function atLeastFloor(v) {
  for (let i = 0; i < JS_YAML_FLOOR.length; i++) {
    if (v[i] > JS_YAML_FLOOR[i]) return true;
    if (v[i] < JS_YAML_FLOOR[i]) return false;
  }
  return true;
}

// Guard the guard: a parser that returned null for everything, or a comparator
// that returned true for everything, would report a clean sweep forever. Prove
// both directions fire before trusting the verdict on the real manifests.
const REJECT = ['^4.1.1', '^4.2.0', '^4.3.0', '~4.3.0', '>=4.0.0', '3.15.0'];
const ACCEPT = ['^4.3.1', '~4.3.2', '4.3.1', '>=4.4.0', '^5.2.3'];
const UNREADABLE = ['4.x', 'latest', '^4.2 || ^5', 'github:nodeca/js-yaml', ''];
const rejectsLow = REJECT.every((r) => {
  const min = rangeMinimum(r);
  return min !== null && !atLeastFloor(min);
});
const acceptsOk = ACCEPT.every((r) => {
  const min = rangeMinimum(r);
  return min !== null && atLeastFloor(min);
});
const flagsUnknown = UNREADABLE.every((r) => rangeMinimum(r) === null);
if (rejectsLow && acceptsOk && flagsUnknown) {
  pass(`floor check rejects ${REJECT.length} low ranges, accepts ${ACCEPT.length} safe ones, and flags ${UNREADABLE.length} it cannot read`);
} else {
  fail(`floor check broken: rejectsLow=${rejectsLow} acceptsOk=${acceptsOk} flagsUnknown=${flagsUnknown} — it would report a clean sweep regardless of the manifests`);
}

const offenders = [];
const unparseable = [];
// A manifest that cannot be read is not a manifest that passes. Anything
// unreadable is its own failure rather than a skip, so the sweep cannot go green
// while covering less of the tree than it claims.
const unreadable = [];
let declaring = 0;

const { files: found, error: discoveryError } = manifests();
for (const file of found) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    unreadable.push(`${relative(ROOT, file)} (${err.code || err.message})`);
    continue;
  }
  // `@types/js-yaml` is types-only and ships no parser, so it is deliberately
  // not covered by the floor.
  const range = pkg.dependencies?.['js-yaml'] ?? pkg.devDependencies?.['js-yaml'];
  if (range === undefined) continue; // a manifest that does not use js-yaml is fine
  declaring++;
  const min = rangeMinimum(range);
  if (min === null) {
    unparseable.push(`${relative(ROOT, file)} declares "${range}"`);
  } else if (!atLeastFloor(min)) {
    offenders.push(`${relative(ROOT, file)} declares "${range}" (admits ${min.join('.')})`);
  }
}

// Zero manifests, or manifests but none declaring js-yaml, both mean the sweep
// proved nothing — the exact shape of silent pass this test exists to prevent.
if (discoveryError !== null) {
  fail(`could not list tracked manifests, so the js-yaml floor sweep ran against nothing: ${discoveryError}`);
} else if (found.length === 0) {
  fail('git ls-files produced no package.json — the js-yaml floor sweep scanned nothing');
} else if (unreadable.length > 0) {
  fail(`could not parse ${unreadable.length} manifest(s), so the js-yaml floor sweep is incomplete: ${unreadable.join(', ')}`);
} else if (declaring === 0) {
  fail(`none of the ${found.length} tracked manifests declares js-yaml — either the dependency was dropped (delete this test) or the sweep is looking in the wrong place`);
} else if (unparseable.length > 0) {
  fail(`js-yaml range(s) this check cannot read as a lower bound, verify against the ${FLOOR_TEXT} floor by hand: ${unparseable.join(', ')}`);
} else if (offenders.length === 0) {
  pass(`all ${declaring} manifest(s) declaring js-yaml are at or above the ${FLOOR_TEXT} floor (GHSA-52cp-r559-cp3m, CVE-2026-59870)`);
} else {
  fail(`js-yaml range(s) below the ${FLOOR_TEXT} security floor — raise them: ${offenders.join(', ')}`);
}
