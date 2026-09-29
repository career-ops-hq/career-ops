// tests/empty-tracker-exit-code.test.mjs — an empty tracker is the state of a
// NEW USER, not a failed command.
//
// Eleven analysis scripts read the same tracker. Ten reported "no data yet" and
// exited 0; analyze-patterns.mjs exited 1 for the same condition, which breaks
// `&&` chaining and makes the batch runners treat a fresh install as a broken
// command.
//
// Asserted as AGREEMENT across the set rather than against a hardcoded exit
// code for one script, so this keeps holding if the convention itself is ever
// revisited — and so a new analysis script joining the family is measured
// against its siblings rather than against a number in a test.
//
// Every required input EXISTS and is empty. That distinction is the whole
// measurement: a MISSING input file is a legitimate non-zero (the caller has to
// create it), and an earlier version of this comparison was wrong because it
// left negotiation-roi without a story bank at all and read the resulting exit 1
// as an exit-code inconsistency. It was a path bug, fixed separately in #3985.
//
// Run:  node --test tests/empty-tracker-exit-code.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Scripts that read the tracker and report on it. negotiation-roi is left out:
// it reads the story bank rather than the tracker, so "empty tracker" is not a
// condition it has an opinion about.
const ANALYSIS_SCRIPTS = [
  'stats.mjs', 'upskill.mjs', 'salary-gap.mjs', 'process-quality.mjs',
  'rejection-latency.mjs', 'detect-reposts.mjs', 'company-history.mjs',
  'calibrate.mjs', 'funnel-velocity.mjs', 'tracker-sync-check.mjs',
  'analyze-patterns.mjs',
];

function emptyButValid() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-emptytracker-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  // A real header and separator with no rows — a tracker that parses and holds
  // nothing, which is exactly what a new user has.
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '',
  ].join('\n'));
  return dir;
}

function exitCodes(dir) {
  const out = {};
  for (const script of ANALYSIS_SCRIPTS) {
    const r = spawnSync(process.execPath, [join(ROOT, script), '--summary'], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(r.error, undefined, `${script} failed to spawn: ${r.error?.message}`);
    out[script] = r.status;
  }
  return out;
}

test('every analysis script agrees on what an empty tracker means', () => {
  const dir = emptyButValid();
  try {
    const codes = exitCodes(dir);
    const distinct = [...new Set(Object.values(codes))];
    assert.equal(
      distinct.length,
      1,
      'the analysis scripts disagree on the exit code for an empty tracker, so `&&` chaining and the '
      + `batch runners see a fresh install as a broken command:\n${
        Object.entries(codes).map(([s, c]) => `  ${s}: exit ${c}`).join('\n')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('and that shared meaning is success', () => {
  // The agreement above could in principle be reached by making all eleven exit
  // 1. It should not be: "you have not evaluated anything yet" is the normal
  // first state of the tool, and AGENTS.md tells users to run these before they
  // have data.
  const dir = emptyButValid();
  try {
    for (const [script, code] of Object.entries(exitCodes(dir))) {
      assert.equal(code, 0, `${script} exits ${code} on an empty tracker`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a real failure still exits non-zero', () => {
  // The guard on the fix: analyze-patterns now checks the KIND of error, so
  // only the no-data case is excused. An unreadable tracker must still fail, or
  // this change would have bought consistency by never reporting anything.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-badtracker-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    // A directory where the tracker file belongs: unreadable, not empty.
    mkdirSync(join(dir, 'data', 'applications.md'), { recursive: true });
    const r = spawnSync(process.execPath, [join(ROOT, 'analyze-patterns.mjs'), '--summary'], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.notEqual(r.status, 0, 'an unreadable tracker was reported as success');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
