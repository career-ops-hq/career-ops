// tests/nonzero-exit-guard.test.mjs — "this command must fail" must not go back
// to meaning "or it was killed".
//
// #5402 fixed 42 assertions of the form
//
//     assert.notEqual(result.status, 0);
//
// which passes for three different reasons, and only one of them is meant:
//
//     the CLI rejected the input   status 1     <- the only case intended
//     the child was killed         status null  <- timeout, SIGTERM
//     the child never started      status null  <- ENOENT, EACCES
//
// null !== 0, so a command killed at its `timeout:` satisfies the assertion and
// a slow runner turns the test green without the CLI ever having parsed its
// input. exitedNonZero() asks the positive question instead.
//
// WHY THIS FILE EXISTS. #5402 swept every site and added nothing to stop the
// pattern returning, and it returned within a week: 14 fresh sites across eight
// test files added between 2026-10-18 and 2026-10-24, every one of them written
// after the sweep. AGENTS.md says it plainly — "Reinforcement-without-
// enforcement decays" — and a sweep without a ratchet is exactly that.
//
// Run:  node --test tests/nonzero-exit-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackedFiles } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Files where "did not exit 0" is genuinely the right question, with the reason.
 *
 * SHRINK-ONLY: an entry that stops carrying the pattern must leave this map, or
 * the list rots into a place where the check silently stops applying — the
 * failure mode KNOWN_WITHOUT_HELP in help-flag-handled.test.mjs guards the same
 * way. Adding an entry is a deliberate act with a stated reason, not a way to
 * quiet a red test.
 */
const KNOWN_NOT_A_SPAWN_RESULT = new Map([
  ['tests/pdf-ats-variant.test.mjs',
    '`gate` comes from steps.find(...) — a parsed documented-step object, not a spawn result'],
  ['tests/tracker-writer-lock.test.mjs',
    'custom {code,timedOut,output}; the test asserts probe.timedOut === false itself, so it is already correct'],
  ['tests/exited-nonzero.test.mjs',
    'demonstrates the old form on purpose, to prove it accepts a killed child'],
  ['web/tests/lib/server-launcher.test.mjs',
    'asserts a SIGTERM-terminated child "must not look successful" — termination IS the point there'],
  ['web/tests/lib/scan-schedule-scripts.test.mjs',
    'web/ keeps to its own test tree and does not import tests/helpers; needs its own copy or a shared move first'],
]);

// Where a `/` can only begin a regex literal, never division. The usual
// heuristic, and enough here: every regex in this tree sits after one of these.
const REGEX_MAY_FOLLOW = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', undefined]);

/**
 * Source with comment, string and REGEX bodies blanked, offsets preserved.
 *
 * Regex literals are not an afterthought. tests/pdf-ats-variant.test.mjs holds
 *
 *     [...STEP_21A.matchAll(/`(node [^`]+)`/g)]
 *
 * and a masker that does not know a regex when it sees one reads the first
 * backtick there as the start of a template literal. The mis-pairing then
 * cascades: every later quote is off by one, and 120 lines further down a real
 * `assert.notEqual(gate.status, 0, …)` masked to an empty line and this guard
 * reported the file as clean. A detector that silently stops seeing its subject
 * is the exact failure the guard-on-the-guard below exists to catch.
 */
function codeOnly(src) {
  const out = [...src];
  let i = 0;
  const n = src.length;
  let lastSig;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i += 1; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '/' && REGEX_MAY_FOLLOW.has(lastSig)) {
      out[i] = ' '; i += 1;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const d = src[i];
        if (d === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { out[i] = ' '; i += 1; break; }
        out[i] = ' '; i += 1;
      }
      lastSig = '/';
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; out[i] = ' '; i += 1;
      while (i < n) {
        if (src[i] === '\\') { out[i] = ' '; if (src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === q) { out[i] = ' '; i += 1; break; }
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      lastSig = q;
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    else if (c === '\n') lastSig = '\n';
    i += 1;
  }
  return out.join('');
}

// The receiver is any identifier, because the result commonly arrives through a
// local helper (`run()`, `cli()`, `runCover()`) rather than straight from
// spawnSync. Masking first is what keeps a doc comment or a fixture string that
// quotes the pattern from reading as a violation — the bug that bit the
// describeSpawn rollout twice.
const PATTERN = /assert\.(?:notEqual|notStrictEqual)\(\s*[A-Za-z_$][\w$]*\.(?:status|code)\s*,\s*0/g;

function scan() {
  // trackedFiles() tests the FILTER against the relative path and returns
  // ABSOLUTE ones, so the read uses the absolute path and the allowlist key is
  // derived back. Separators are normalised because the keys below are written
  // with forward slashes and this has to agree on Windows.
  const files = trackedFiles(ROOT, (rel) => rel.endsWith('.test.mjs'));
  const hits = new Map();
  for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    const code = codeOnly(readFileSync(abs, 'utf-8'));
    const n = [...code.matchAll(PATTERN)].length;
    if (n > 0) hits.set(rel, n);
  }
  return { files, hits };
}

test('no test asserts a failure in a way a killed child satisfies', () => {
  const { files, hits } = scan();

  // A guard on the guard. If the enumeration or the pattern ever stops
  // matching, every assertion below would pass over an empty list and report as
  // coverage. The known entries are the floor: the detector must still see them.
  assert.ok(files.length >= 500,
    `only ${files.length} test files enumerated — the scan has lost its subject`);
  assert.ok(hits.size >= KNOWN_NOT_A_SPAWN_RESULT.size,
    `the pattern matched in ${hits.size} files but ${KNOWN_NOT_A_SPAWN_RESULT.size} are known to carry it `
    + '— the detector has rotted, not the tree');

  const offenders = [...hits.keys()].filter((rel) => !KNOWN_NOT_A_SPAWN_RESULT.has(rel)).sort();
  assert.deepEqual(offenders, [],
    'these assert a non-zero exit in a way a timeout kill also satisfies, so a slow runner turns them '
    + 'green without the command under test having run: ' + offenders.join(', ')
    + '. Use assert.ok(exitedNonZero(r), describeSpawn(r, "...")) from tests/helpers/describe-spawn.mjs, '
    + 'or add the file to KNOWN_NOT_A_SPAWN_RESULT with the reason it is not a spawn result.');
});

test('the allowlist shrinks and never just sits there', () => {
  const { hits } = scan();
  const stale = [...KNOWN_NOT_A_SPAWN_RESULT.keys()].filter((rel) => !hits.has(rel)).sort();
  assert.deepEqual(stale, [],
    'these no longer carry the pattern, so they must leave KNOWN_NOT_A_SPAWN_RESULT — an allowlist that '
    + 'keeps entries it no longer needs is how the check quietly stops applying: ' + stale.join(', '));
});

test('every allowlist entry states why it is exempt', () => {
  // An entry without a reason is indistinguishable from one added to silence a
  // red test, which is the way this kind of list usually dies.
  for (const [rel, reason] of KNOWN_NOT_A_SPAWN_RESULT) {
    assert.ok(typeof reason === 'string' && reason.trim().length >= 25,
      `${rel} needs a real reason for being exempt, got ${JSON.stringify(reason)}`);
  }
});
