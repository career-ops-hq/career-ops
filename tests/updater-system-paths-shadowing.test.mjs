// tests/updater-system-paths-shadowing.test.mjs — no SYSTEM_PATHS file entry may sit
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
import { extractArrayFromSource } from '../update-system.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nupdate-system.mjs — no shadowed SYSTEM_PATHS entries');

// The manifest is read with update-system.mjs's OWN exported extractor rather
// than a regex of this file's own. A second parser is a second set of rules to
// drift: the first draft here required exactly two spaces and a single quote,
// which silently skipped any other style — not a parse error, an entry the
// shadowing check never examined while `entries.length > 0` still held. It
// also read entries out of `/* ... */` comments and rejected `const X=[`,
// neither of which the production extractor does (CodeRabbit, #3766).
// Calling the shipped function makes those questions unaskable: whatever the
// updater considers an entry is exactly what is checked here, and
// tests/updater-extract-array-syntax.test.mjs already covers the parser itself.

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

const entries = src ? extractArrayFromSource(src, 'SYSTEM_PATHS') : [];

if (entries.length > 0) {
  pass(`SYSTEM_PATHS parsed via update-system.mjs's own extractor (${entries.length} entries)`);
} else if (src) {
  fail('could not parse SYSTEM_PATHS — this guard would pass vacuously');
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
