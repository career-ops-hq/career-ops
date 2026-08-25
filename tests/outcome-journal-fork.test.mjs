// tests/outcome-journal-fork.test.mjs — one application, one journal.
//
// outcome.mjs stores an application's outcome journal and artifacts in
// data/outcomes/{num}_{company_slug}_{role_slug}/, and that journal is
// append-only: "the LAST `## Entry:` block is the current truth"
// (calibrate.mjs's parseOutcomeJournal).
//
// The directory name was rebuilt from the tracker row's CURRENT text on every
// call, so editing the Role cell between two recordings — normalising "Senior
// Backend Engineer" to "Sr. Backend Engineer" — sent the second entry
// somewhere else. Reproduced against the real CLI before the fix:
//
//   1_acme_senior-backend-engineer/outcome.md   interview_progress
//   1_acme_sr-backend-engineer/outcome.md       rejected
//
// One application, two half-journals, and no reader merges them. Every consumer
// keys on the leading `{num}_`, so which half it saw came down to alphabetical
// directory order — not to when anything happened. Recorded artifacts
// (submitted_cv.md, posting.pdf, the cover letter) split the same way.
//
// Run:  node --test tests/outcome-journal-fork.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outcomeDirsFor, resolveOutcomeDir } from '../lib/outcome-dir.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TRACKER = (role) => [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  `| 1 | 2026-01-05 | Acme | ${role} | 4.6/5 | Interview | ❌ | — | notes |`,
].join('\n');

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-outcome-fork-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  return dir;
}

function record(dir, args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'outcome.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md') },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  // Exit status, not just "it spawned". outcome.mjs writes outcome.md BEFORE
  // it updates the tracker, so a failure after the journal write leaves every
  // file these tests look for while r.error stays undefined — the assertions
  // below would pass on a command that failed.
  assert.equal(r.status, 0, `outcome.mjs ${args.join(' ')} exited ${r.status}: ${r.stderr || r.stdout}`);
  return r;
}

test('a role edit between two recordings does not fork the journal', () => {
  const dir = sandbox();
  try {
    writeFileSync(join(dir, 'data', 'applications.md'), TRACKER('Senior Backend Engineer'));
    record(dir, ['1', 'interview_progress', '--stage', 'Tech Screen']);

    // The user normalises the title — an ordinary tracker edit.
    writeFileSync(join(dir, 'data', 'applications.md'), TRACKER('Sr. Backend Engineer'));
    record(dir, ['1', 'rejected']);

    const dirs = readdirSync(join(dir, 'data', 'outcomes'));
    assert.deepEqual(dirs, ['1_acme_senior-backend-engineer'], `journal forked across ${dirs.length} directories`);

    // And the surviving journal holds BOTH entries, in order — the append-only
    // contract. A directory count of 1 with the first entry overwritten would
    // satisfy the assertion above and none of the point.
    const log = readFileSync(join(dir, 'data', 'outcomes', dirs[0], 'outcome.md'), 'utf-8');
    const types = [...log.matchAll(/^- \*\*Outcome Type\*\*: (\S+)/gm)].map((m) => m[1]);
    assert.deepEqual(types, ['interview_progress', 'rejected']);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a first recording still names the directory from the slugs', () => {
  const dir = sandbox();
  try {
    writeFileSync(join(dir, 'data', 'applications.md'), TRACKER('Staff Data Engineer'));
    record(dir, ['1', 'rejected']);
    assert.deepEqual(readdirSync(join(dir, 'data', 'outcomes')), ['1_acme_staff-data-engineer']);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('an existing split resolves to the most recently written journal, not the first-sorting one', () => {
  // Repairing a split means moving a user's recorded artifacts, which neither
  // the writer nor a read-only report should do on its own. What both must stop
  // doing is choosing by alphabetical accident.
  const dir = sandbox();
  try {
    const outcomes = join(dir, 'data', 'outcomes');
    for (const name of ['1_acme_senior-backend-engineer', '1_acme_sr-backend-engineer']) {
      mkdirSync(join(outcomes, name), { recursive: true });
      writeFileSync(join(outcomes, name, 'outcome.md'), '## Entry: x\n');
    }
    // Make the FIRST-sorting directory the OLDER one, so sort order and recency
    // disagree — the case that decides whether this is really time-based.
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(join(outcomes, '1_acme_senior-backend-engineer', 'outcome.md'), old, old);

    assert.deepEqual(outcomeDirsFor(outcomes, 1), ['1_acme_sr-backend-engineer', '1_acme_senior-backend-engineer']);
    assert.equal(resolveOutcomeDir(outcomes, 1, '1_acme_new').name, '1_acme_sr-backend-engineer');
    assert.equal(resolveOutcomeDir(outcomes, 1, '1_acme_new').existing.length, 2, 'the split must be reported to the caller');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a directory with no journal never outranks one that has entries', () => {
  const dir = sandbox();
  try {
    const outcomes = join(dir, 'data', 'outcomes');
    mkdirSync(join(outcomes, '1_acme_with-journal'), { recursive: true });
    writeFileSync(join(outcomes, '1_acme_with-journal', 'outcome.md'), '## Entry: x\n');
    const older = new Date('2020-01-01T00:00:00Z');
    utimesSync(join(outcomes, '1_acme_with-journal', 'outcome.md'), older, older);
    // Artifacts only — created later, so a naive mtime sort would prefer it.
    mkdirSync(join(outcomes, '1_acme_artifacts-only'), { recursive: true });
    writeFileSync(join(outcomes, '1_acme_artifacts-only', 'submitted_cv.md'), '# cv\n');

    assert.equal(outcomeDirsFor(outcomes, 1)[0], '1_acme_with-journal');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('the prefix match is on the whole number, not a numeric prefix', () => {
  // `1_` must not claim `12_…`. Without the underscore this silently merges two
  // unrelated applications' histories.
  const dir = sandbox();
  try {
    const outcomes = join(dir, 'data', 'outcomes');
    for (const name of ['1_acme_role', '12_globex_role', '100_initech_role']) {
      mkdirSync(join(outcomes, name), { recursive: true });
      writeFileSync(join(outcomes, name, 'outcome.md'), '## Entry: x\n');
    }
    assert.deepEqual(outcomeDirsFor(outcomes, 1), ['1_acme_role']);
    assert.deepEqual(outcomeDirsFor(outcomes, 12), ['12_globex_role']);
    assert.deepEqual(outcomeDirsFor(outcomes, 100), ['100_initech_role']);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a missing outcomes root is not an error', () => {
  const dir = sandbox();
  try {
    assert.deepEqual(outcomeDirsFor(join(dir, 'data', 'outcomes'), 1), []);
    assert.equal(resolveOutcomeDir(join(dir, 'data', 'outcomes'), 1, '1_a_b').name, '1_a_b');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
