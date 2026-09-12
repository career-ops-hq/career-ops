// tests/set-status-seeds-followup.test.mjs — the transition into Applied is
// where the first follow-up gets scheduled (#1430), for every caller (#3459).
//
// set-status.mjs used to only ANNOUNCE that: it emitted
// `followupSeedCandidate: true` and nothing consumed the flag. The only callers
// of followup-seed.mjs were modes/apply.md and modes/followup.md — agent
// instructions — so recording an application from the web UI or from this CLI
// wrote the tracker and the transition ledger correctly and scheduled nothing,
// silently.
//
// Seeding in set-status.mjs is what makes that one fix rather than three: #2901
// converged /api/status onto this script, so the web path inherits it, and so
// does every future caller that delegates here instead of editing the table.
//
// Run:  node --test tests/set-status-seeds-followup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sandbox(status = 'Evaluated') {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-seed-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${status} | ✅ | [7](../reports/007-acme-2026-02-01.md) | notes |`,
    '',
  ].join('\n'));
  return dir;
}

function setStatus(dir, args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md') },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const followups = (dir) => join(dir, 'data', 'follow-ups.md');
const pinsFor = (dir, num) => {
  if (!existsSync(followups(dir))) return 0;
  return readFileSync(followups(dir), 'utf-8').split('\n').filter((l) => l.includes(`next #${num} `)).length;
};

test('a transition into Applied seeds the first follow-up', () => {
  const dir = sandbox();
  try {
    const r = setStatus(dir, ['--row', '7', 'Applied']);
    assert.equal(r.status, 0, r.all);
    assert.equal(pinsFor(dir, 7), 1, `nothing was scheduled:\n${r.all}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('it seeds beside the tracker it just wrote, not beside the repo', () => {
  // followup-seed's own default is the REPO's data/follow-ups.md. Left to it,
  // an install whose data lives outside the checkout — which is the whole point
  // of CAREER_OPS_TRACKER, and how the web configures its root — would get the
  // status written to one tracker and the follow-up seeded next to another.
  const dir = sandbox();
  const repoFollowups = join(ROOT, 'data', 'follow-ups.md');
  const existedBefore = existsSync(repoFollowups);
  try {
    setStatus(dir, ['--row', '7', 'Applied']);
    assert.ok(existsSync(followups(dir)), 'the sandbox follow-ups file was not written');
    assert.equal(existsSync(repoFollowups), existedBefore, 'seeding wrote into the repo instead of the configured root');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('re-running on an already-Applied row does not stack a second pin', () => {
  const dir = sandbox();
  try {
    setStatus(dir, ['--row', '7', 'Applied']);
    setStatus(dir, ['--row', '7', 'Applied']);
    assert.equal(pinsFor(dir, 7), 1, 'a duplicate follow-up was seeded on re-run');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('--dry-run previews the seed and writes nothing', () => {
  // The row is deliberately NOT written on a dry run, so seedFollowup re-reads
  // a row that is still Evaluated. Without forcing the preview it reports a
  // failure for the one thing the real run is about to do — which is why the
  // message matters here, not just the absence of a file.
  const dir = sandbox();
  try {
    const r = setStatus(dir, ['--row', '7', 'Applied', '--dry-run']);
    assert.equal(r.status, 0, r.all);
    assert.match(r.all, /Follow-up would be seeded/, `dry run did not preview the seed:\n${r.all}`);
    assert.doesNotMatch(r.all, /follow-up seeding failed/, 'dry run reported a failure');
    assert.ok(!existsSync(followups(dir)), 'dry run wrote a follow-ups file');
    assert.match(readFileSync(join(dir, 'data', 'applications.md'), 'utf-8'), /Evaluated/, 'dry run wrote the tracker');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a transition to any other status seeds nothing', () => {
  const dir = sandbox();
  try {
    setStatus(dir, ['--row', '7', 'Interview']);
    assert.equal(pinsFor(dir, 7), 0, 'a non-Applied transition scheduled a follow-up');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('the JSON result reports what actually happened', () => {
  const dir = sandbox();
  try {
    const r = setStatus(dir, ['--row', '7', 'Applied', '--json']);
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    // followupSeedCandidate is kept for anything already reading it; the
    // outcome now travels beside it instead of only the intention.
    assert.equal(parsed.followupSeedCandidate, true);
    assert.equal(parsed.followupSeeded?.seeded, true);
    assert.match(parsed.followupSeeded.nextDate, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a seeding failure never fails the status change', () => {
  // The write has already committed by the time seeding runs, and the exit code
  // is about that write. Made unwritable rather than mocked, so this exercises
  // the real failure path.
  const dir = sandbox();
  try {
    mkdirSync(followups(dir), { recursive: true });   // a DIRECTORY where the file goes
    const r = setStatus(dir, ['--row', '7', 'Applied']);
    assert.equal(r.status, 0, `the status change was failed by a seeding problem:\n${r.all}`);
    assert.match(readFileSync(join(dir, 'data', 'applications.md'), 'utf-8'), /Applied/, 'the status was not written');
    assert.match(r.all, /follow-up seeding failed/, 'the seeding failure was not reported');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

const jsonOf = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

test('--on anchors the follow-up on the day the application was really sent', () => {
  // --on is the day the transition REALLY happened, and for a transition into
  // Applied that is the day the application went out. Nothing else carries it:
  // the tracker's date column is the EVALUATION date (2026-02-01 in the
  // fixture) and set-status never rewrites it, so a dropped --on silently
  // anchors the cadence on the wrong day.
  //
  // Asserted as a difference between two runs rather than against a hardcoded
  // date, so the cadence length stays configurable: backdating the anchor by
  // 27 days must move the first follow-up back by exactly 27 days.
  const withOn = sandbox();
  const withoutOn = sandbox();
  try {
    const anchored = jsonOf(setStatus(withOn, ['--row', '7', 'Applied', '--on', '2026-01-05', '--json']));
    const unanchored = jsonOf(setStatus(withoutOn, ['--row', '7', 'Applied', '--json']));
    const shift = daysBetween(anchored.followupSeeded.nextDate, unanchored.followupSeeded.nextDate);
    assert.equal(
      shift,
      daysBetween('2026-01-05', '2026-02-01'),
      `--on did not reach the seeder: it scheduled ${anchored.followupSeeded.nextDate} from a 2026-01-05 apply date, ` +
      `the same as the ${unanchored.followupSeeded.nextDate} it picks off the evaluation-date column with no --on at all`,
    );
  } finally {
    for (const d of [withOn, withoutOn]) rmSync(d, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('--dry-run does not promise a pin the real run would refuse', () => {
  // The preview has to relax the Applied-status guard, because on a dry run the
  // row was deliberately not written and is still Evaluated. What it must NOT
  // relax is idempotency: a row that already carries a pin gets `already-seeded`
  // from a real run, so a preview claiming a fresh pin is a preview of something
  // that will not happen.
  const dir = sandbox();
  try {
    setStatus(dir, ['--row', '7', 'Applied']);      // a pin now exists
    setStatus(dir, ['--row', '7', 'Interview']);    // so the next Applied is a real transition again

    const dry = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--dry-run', '--json']));
    assert.equal(dry.followupSeeded?.seeded, false, 'the preview promised a pin on a row that already has one');
    assert.equal(dry.followupSeeded?.reason, 'already-seeded');

    const real = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--json']));
    assert.equal(real.followupSeeded?.seeded, false, 'the real run seeded a duplicate');
    assert.equal(real.followupSeeded?.reason, dry.followupSeeded?.reason, 'the preview and the real run disagree');
    assert.equal(pinsFor(dir, 7), 1, 'a duplicate pin was written');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
