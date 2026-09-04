// tests/system-paths-no-shadowing.test.mjs — no SYSTEM_PATHS file entry may sit
// under a directory entry that already covers it.
//
// `covered()` in validate-system-paths-coverage.mjs matches a trailing-slash
// entry by prefix, and `pathMatchesManifest` in update-system.mjs does the same
// for the stale-file prune. So a directory entry covers everything beneath it
// for BOTH things the manifest is used for — delivery and pruning — and a file
// entry underneath one is dead weight.
//
// It is not harmless dead weight. SYSTEM_PATHS decides what an update
// overwrites in a user's install, and its value depends on a reader being able
// to tell what it actually asserts. Entries that cannot change the outcome
// invite the belief that the list is per-file, and therefore that every new
// file needs a line — which is how eighteen of them accumulated (#3766).
//
// The inverse mistake is the dangerous one and is NOT what this checks: a path
// RETIRED from the tree must stay listed, because the prune only reaches files
// a manifest entry matches (#3765). Retired paths are not shadowed by a
// directory entry, so they do not trip this.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nupdate-system.mjs — no shadowed SYSTEM_PATHS entries');

/**
 * Manifest entries in a SYSTEM_PATHS-style array body.
 *
 * Accepts any indentation and either quote style. The first version required
 * exactly two spaces and a single quote, which silently skipped anything else
 * — and a skipped entry is not a parse error here, it is an entry the
 * shadowing check never examines while `entries.length > 0` still holds. That
 * is a false green in a guard, which is the failure this whole file exists to
 * prevent. Every entry is two-space single-quoted today; the point is that the
 * 310th does not have to be.
 */
export function manifestEntries(body) {
  return Array.from(body.matchAll(/^\s*(['"])([^'"]+)\1\s*,/gm), (m) => m[2]);
}

// A missing or renamed update-system.mjs must report as a controlled failure,
// not an uncaught throw: the throw is contained by test-all.mjs's #2828 guard,
// but it reads as "suite crashed" rather than "the manifest is not where this
// expects", which is the actionable half.
let src = null;
try {
  src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
} catch (err) {
  fail(`update-system.mjs is unreadable at ${ROOT} (${err.code || err.message}) — the manifest was never parsed, so this is not a clean result`);
}

const block = src ? src.match(/const SYSTEM_PATHS = \[([\s\S]*?)\n\];/) : null;
const entries = block ? manifestEntries(block[1]) : [];

if (entries.length > 0) {
  pass(`SYSTEM_PATHS parsed (${entries.length} entries)`);
} else if (src) {
  fail('could not parse SYSTEM_PATHS — this guard would pass vacuously');
}

// The parser is part of the guard: one that quietly stops seeing entries turns
// this file green while checking less.
const PARSE_CASES = [
  ["  'a.mjs',", ['a.mjs'], 'two-space single-quoted (every entry today)'],
  ['  "b.mjs",', ['b.mjs'], 'double-quoted'],
  ["    'c.mjs',", ['c.mjs'], 'deeper indentation'],
  ["  // 'd.mjs' was retired", [], 'a commented-out entry is not an entry'],
];
const parseFailures = PARSE_CASES
  .filter(([body, want]) => JSON.stringify(manifestEntries(body)) !== JSON.stringify(want))
  .map(([body, want, label]) => `${label}: got ${JSON.stringify(manifestEntries(body))}, want ${JSON.stringify(want)}`);
if (parseFailures.length === 0) {
  pass(`the entry parser reads all ${PARSE_CASES.length} supported styles`);
} else {
  fail(`${parseFailures.length} parser case(s) failed:\n` + parseFailures.map((f) => `    ${f}`).join('\n'));
}

const dirs = entries.filter((e) => e.endsWith('/'));
const shadowed = entries.filter((e) => !e.endsWith('/') && dirs.some((d) => e.startsWith(d)));

if (entries.length > 0 && dirs.length > 0) {
  pass(`${dirs.length} directory entries to check against`);
}

if (shadowed.length === 0) {
  pass('no file entry is shadowed by a directory entry that already covers it');
} else {
  fail(
    `${shadowed.length} redundant entr(y/ies) — a directory entry above already covers these:\n` +
      shadowed.map((n) => `    ${n}`).join('\n') +
      '\n  Remove the file entry. The directory entry ships AND prunes it (#3766).',
  );
}
