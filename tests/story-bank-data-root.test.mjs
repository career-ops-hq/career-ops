// tests/story-bank-data-root.test.mjs — interview-prep/story-bank.md follows
// the user's data root, in all three readers.
//
// It is named in the Source-of-Truth Boundary as a derived-trust input for
// generated content, and it was resolved three different ways:
//
//   match-star.mjs:22               'interview-prep/story-bank.md'          -> cwd
//   story-provenance-check.mjs:162  'interview-prep/story-bank.md'          -> cwd
//   negotiation-roi.mjs:70          join(CAREER_OPS, 'interview-prep', ...) -> CODE root
//
// The negotiation-roi case is the sharp one. Both roots were already defined in
// that file, and its v1 SAFETY GATE compares the two files — a claim survives
// only if its number also appears verbatim in cv.md:
//
//   const STORY_BANK_PATH = join(CAREER_OPS, ...)   // CODE root
//   const CV_PATH         = join(DATA_ROOT, 'cv.md') // DATA root
//
// Two halves of one comparison, pointed at two different installs. For any
// configured data root the gate read a story bank that is not there, found no
// claims, and produced an empty draft — which reads as "you have no quantified
// stories", not as "I looked in the wrong place".
//
// Each check runs with the data root and the cwd pointed at DIFFERENT
// directories; from the data root the bug is invisible.
//
// Run:  node --test tests/story-bank-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// `###` headings are what match-star parses; the number is repeated verbatim in
// cv.md so negotiation-roi's gate has something that legitimately survives it.
const STORY_BANK = [
  '# Story Bank',
  '',
  '### [Delivery] Cut deploy time',
  '**Situation:** Releases took four hours of manual steps.',
  '**Task:** Make releases routine.',
  '**Action:** Built a pipeline with staged rollout.',
  '**Result:** Cut deploy time by 40 minutes per release.',
  '**Tags:** ci, automation',
  '',
].join('\n');

const CV = '# CV\n\n- Cut deploy time by 40 minutes per release.\n';

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-storybank-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-storydecoy-'));
  mkdirSync(join(dataRoot, 'interview-prep'), { recursive: true });
  writeFileSync(join(dataRoot, 'interview-prep', 'story-bank.md'), STORY_BANK);
  writeFileSync(join(dataRoot, 'cv.md'), CV);
  return { dataRoot, decoyCwd };
}

const cleanup = (f) => {
  for (const d of [f.dataRoot, f.decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

function run(script, args, f) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: f.decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: f.dataRoot, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('match-star reads the data root story bank', () => {
  const f = fixture();
  try {
    const r = run('match-star.mjs', ['--list'], f);
    assert.doesNotMatch(r.all, /not found/i, `it looked somewhere else:\n${r.all.slice(0, 300)}`);
    assert.match(r.all, /Cut deploy time/, `the story was not read:\n${r.all.slice(0, 300)}`);
  } finally { cleanup(f); }
});

test('story-provenance-check reads the data root story bank and cv.md', () => {
  const f = fixture();
  try {
    const r = run('story-provenance-check.mjs', ['--summary'], f);
    assert.doesNotMatch(
      r.all,
      /story-bank\.md not found|No story bank/i,
      `it looked somewhere else:\n${r.all.slice(0, 300)}`,
    );
  } finally { cleanup(f); }
});

test("negotiation-roi's safety gate reads both files from the SAME root", () => {
  // The regression that matters. The gate keeps a claim only when its number
  // also appears verbatim in cv.md; with the two files on different roots it
  // could never match, whatever the user wrote.
  const f = fixture();
  try {
    const r = run('negotiation-roi.mjs', ['--summary', '--wage', '120000', '--frequency', 'annually'], f);
    // Asserted on stories SCANNED, not on a claim surviving the gate. Whether
    // this particular Result line yields an extractable claim is the claim
    // parser's business; what this test owns is that the file was found at all.
    // On the old code this read 0 for any configured data root.
    assert.match(
      r.all,
      /Stories scanned:\s*1/,
      `the gate read no stories — the two halves of its comparison are still on different roots:\n${r.all.slice(0, 400)}`,
    );
    assert.doesNotMatch(r.all, /story-bank\.md not found/i, `it looked somewhere else:\n${r.all.slice(0, 300)}`);
  } finally { cleanup(f); }
});

test('an absent story bank still reports the path it actually looked at', () => {
  // The diagnosis has to name the resolved path, or "not found" sends the user
  // to check a file that was never the one being read.
  const f = fixture();
  rmSync(join(f.dataRoot, 'interview-prep', 'story-bank.md'));
  try {
    const r = run('match-star.mjs', ['--list'], f);
    assert.match(r.all, /not found/i, 'an absent story bank was not reported');
    assert.ok(
      r.all.includes(f.dataRoot),
      `the error names a path other than the one it resolved:\n${r.all.slice(0, 300)}`,
    );
  } finally { cleanup(f); }
});

test('--story-bank and --cv still override', () => {
  // story-provenance-check documents both flags; anchoring the DEFAULT must not
  // take the explicit path away.
  const f = fixture();
  const other = mkdtempSync(join(tmpdir(), 'career-ops-storyalt-'));
  try {
    writeFileSync(join(other, 'sb.md'), STORY_BANK);
    writeFileSync(join(other, 'cv.md'), CV);
    const r = spawnSync(process.execPath, [
      join(ROOT, 'story-provenance-check.mjs'), '--summary',
      '--story-bank', join(other, 'sb.md'), '--cv', join(other, 'cv.md'),
    ], {
      cwd: f.decoyCwd, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: f.dataRoot, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(r.status, 0, `explicit paths were not honoured: ${r.stdout}${r.stderr}`);
  } finally {
    cleanup(f);
    rmSync(other, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('no reader of story-bank.md resolves it from the code root or the cwd', () => {
  // Structural, in the spirit of #3511's check 6: the three spellings that
  // caused this are a bare relative literal and a join onto a __dirname
  // constant. Covers the next reader, not just today's three.
  const offenders = [];
  for (const file of ['match-star.mjs', 'story-provenance-check.mjs', 'negotiation-roi.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    for (const line of src.split('\n')) {
      if (!/story-bank\.md|'cv\.md'/.test(line)) continue;
      if (/^\s*(\/\/|\*)/.test(line)) continue;                       // comment
      if (/=\s*'(interview-prep|cv\.md)/.test(line)) offenders.push(`${file}: ${line.trim().slice(0, 76)}`);
      if (/join\(\s*(CAREER_OPS|CODE_ROOT)\s*,/.test(line)) offenders.push(`${file}: ${line.trim().slice(0, 76)}`);
    }
  }
  assert.deepEqual(offenders, [], `story-bank/cv.md resolved off the data root:\n${offenders.join('\n')}`);
});
