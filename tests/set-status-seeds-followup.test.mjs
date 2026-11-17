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
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { localToday } from '../lib/local-today.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const followups = (dir) => join(dir, 'data', 'follow-ups.md');
// A developer shell may point these at real files. The child must not.
const CLEARED = [
  'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV',
  'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_ACTIVITY_DIR',
  'CAREER_OPS_FOLLOWUPS_LOCK',
];

function sandbox(status = 'Evaluated', notes = 'notes') {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-seed-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${status} | ✅ | [7](../reports/007-acme-2026-02-01.md) | ${notes} |`,
    '',
  ].join('\n'));
  return dir;
}

function setStatus(dir, args) {
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    CAREER_OPS_FOLLOWUPS: followups(dir),
  };
  for (const name of CLEARED) env[name] = '';
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env,
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const pinsFor = (dir, num) => {
  if (!existsSync(followups(dir))) return 0;
  return readFileSync(followups(dir), 'utf-8').split('\n').filter((l) => l.includes(`next #${num} `)).length;
};

test('a transition into Applied seeds the first follow-up', () => {
  const dir = sandbox();
  try {
    const r = setStatus(dir, ['--row', '7', 'Applied']);
    assert.equal(r.status, 0, describeSpawn(r));
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

test('a pin stays in the sandbox when the parent follow-ups path and profile point elsewhere', () => {
  const dir = sandbox();
  const elsewhere = mkdtempSync(join(tmpdir(), 'career-ops-followups-elsewhere-'));
  const outsidePins = join(elsewhere, 'follow-ups.md');
  writeFileSync(join(elsewhere, 'profile.yml'), 'follow_ups:\n  enabled: false\n');
  const saved = {
    CAREER_OPS_FOLLOWUPS: process.env.CAREER_OPS_FOLLOWUPS,
    CAREER_OPS_PROFILE: process.env.CAREER_OPS_PROFILE,
  };
  process.env.CAREER_OPS_FOLLOWUPS = outsidePins;
  process.env.CAREER_OPS_PROFILE = join(elsewhere, 'profile.yml');
  try {
    const result = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--json']));
    assert.equal(result.followupSeeded?.seeded, true, JSON.stringify(result.followupSeeded));
    assert.equal(pinsFor(dir, 7), 1);
    assert.equal(existsSync(outsidePins), false);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(elsewhere, { recursive: true, force: true, maxRetries: 10 });
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
    assert.equal(r.status, 0, describeSpawn(r));
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
    assert.equal(r.status, 0, describeSpawn(r, `the status change was failed by a seeding problem:\n`));
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
  // The tracker's date column is the EVALUATION date (2026-02-01 in the
  // fixture). The anchor is --on when given and today otherwise, the same day
  // the transition ledger records. Compared as offsets so the cadence length
  // stays configurable.
  const withOn = sandbox();
  const withoutOn = sandbox();
  try {
    const anchored = jsonOf(setStatus(withOn, ['--row', '7', 'Applied', '--on', '2026-01-05', '--json']));
    const unanchored = jsonOf(setStatus(withoutOn, ['--row', '7', 'Applied', '--json']));
    const cadence = daysBetween('2026-01-05', anchored.followupSeeded.nextDate);
    assert.ok(cadence > 0, `--on did not reach the seeder: ${anchored.followupSeeded.nextDate}`);
    const transitionDate = readFileSync(join(withoutOn, 'data', 'status-log.tsv'), 'utf-8').trim().split('\n').pop().split('\t')[1];
    assert.equal(
      daysBetween(transitionDate, unanchored.followupSeeded.nextDate),
      cadence,
      `with no --on the first follow-up (${unanchored.followupSeeded.nextDate}) was not anchored on today`,
    );
  } finally {
    for (const d of [withOn, withoutOn]) rmSync(d, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('an apply date in the notes outranks today when --on is absent', () => {
  const fromNotes = sandbox('Evaluated', 'Applied 2026-09-20');
  const fromOn = sandbox();
  try {
    const noted = jsonOf(setStatus(fromNotes, ['--row', '7', 'Applied', '--json']));
    const explicit = jsonOf(setStatus(fromOn, ['--row', '7', 'Applied', '--on', '2026-09-20', '--json']));
    assert.equal(noted.followupSeeded.nextDate, explicit.followupSeeded.nextDate);
  } finally {
    rmSync(fromNotes, { recursive: true, force: true, maxRetries: 10 });
    rmSync(fromOn, { recursive: true, force: true, maxRetries: 10 });
  }
});

function northwind(status, notes = 'panel notes') {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-applied-day-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 7 | 2026-02-01 | Northwind | Analyst | 4.4/5 | ${status} | — | — | ${notes} |`,
    '',
  ].join('\n'));
  return dir;
}

const rowLine = (dir) => readFileSync(join(dir, 'data', 'applications.md'), 'utf-8')
  .split('\n')
  .find((line) => line.startsWith('| 7 |'));
const statusCell = (dir) => rowLine(dir).split('|')[6].trim();
const logDate = (dir) => readFileSync(join(dir, 'data', 'status-log.tsv'), 'utf-8').trim().split('\n').pop().split('\t')[1];
const pinDate = (dir) => readFileSync(followups(dir), 'utf-8').match(/next #7 (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

test('rewriting Applied 2026-01-02 keeps that day on the status log and the follow-up pin', () => {
  const dated = northwind('Applied 2026-01-02');
  const explicit = northwind('Evaluated');
  try {
    const datedRun = setStatus(dated, ['--row', '7', 'Applied', '--json']);
    assert.equal(datedRun.status, 0, describeSpawn(datedRun));
    const rewritten = jsonOf(datedRun);
    const fromOn = jsonOf(setStatus(explicit, ['--row', '7', 'Applied', '--on', '2026-01-02', '--json']));
    assert.equal(statusCell(dated), 'Applied');
    assert.equal(logDate(dated), '2026-01-02');
    assert.equal(pinDate(dated), fromOn.followupSeeded.nextDate);
    assert.equal(rewritten.followupSeeded.nextDate, fromOn.followupSeeded.nextDate);
    assert.match(rowLine(dated), /Northwind \| Analyst/);
    assert.doesNotMatch(rowLine(dated), /Applied 2026-01-02/);
  } finally {
    rmSync(dated, { recursive: true, force: true, maxRetries: 10 });
    rmSync(explicit, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('text moved out of a dated Applied cell is not a notes date', () => {
  const dated = northwind('Applied 2026-01-02 via referral');
  const explicit = northwind('Evaluated');
  const noted = northwind('Applied 2026-01-02 via referral');
  const fromNotes = northwind('Evaluated', 'Applied 2026-09-20');
  try {
    const rewritten = jsonOf(setStatus(dated, ['--row', '7', 'Applied', '--json']));
    const fromOn = jsonOf(setStatus(explicit, ['--row', '7', 'Applied', '--on', '2026-01-02', '--json']));
    assert.equal(statusCell(dated), 'Applied');
    assert.match(rowLine(dated), /Applied 2026-01-02 via referral/);
    assert.equal(logDate(dated), '2026-01-02');
    assert.equal(pinDate(dated), fromOn.followupSeeded.nextDate);
    assert.equal(rewritten.followupSeeded.nextDate, fromOn.followupSeeded.nextDate);
    const withNote = jsonOf(setStatus(noted, ['--row', '7', 'Applied', '--note', 'Applied 2026-09-20', '--json']));
    assert.equal(logDate(noted), localToday());
    assert.notEqual(logDate(noted), '2026-01-02');
    assert.match(rowLine(noted), /Applied 2026-09-20/);
    assert.equal(withNote.followupSeeded.nextDate, jsonOf(setStatus(fromNotes, ['--row', '7', 'Applied', '--json'])).followupSeeded.nextDate);
  } finally {
    for (const dir of [dated, explicit, noted, fromNotes]) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    }
  }
});

test('rewriting a dated Applied cell keeps an Applied date already in the notes', () => {
  const dated = northwind('Applied 2026-01-02', 'Applied 2026-09-20');
  const fromNotes = northwind('Evaluated', 'Applied 2026-09-20');
  try {
    const rewritten = jsonOf(setStatus(dated, ['--row', '7', 'Applied', '--json']));
    const noted = jsonOf(setStatus(fromNotes, ['--row', '7', 'Applied', '--json']));
    assert.equal(rewritten.followupSeeded?.seeded, true, JSON.stringify(rewritten.followupSeeded));
    assert.equal(statusCell(dated), 'Applied');
    assert.match(rowLine(dated), /Applied 2026-09-20/);
    assert.equal(logDate(dated), localToday());
    assert.notEqual(logDate(dated), '2026-01-02');
    assert.equal(pinDate(dated), noted.followupSeeded.nextDate);
    assert.equal(rewritten.followupSeeded.nextDate, noted.followupSeeded.nextDate);
  } finally {
    rmSync(dated, { recursive: true, force: true, maxRetries: 10 });
    rmSync(fromNotes, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a first change from Evaluated to Applied still uses today', () => {
  const fresh = northwind('Evaluated');
  try {
    const result = jsonOf(setStatus(fresh, ['--row', '7', 'Applied', '--json']));
    assert.equal(statusCell(fresh), 'Applied');
    assert.equal(logDate(fresh), localToday());
    assert.equal(pinDate(fresh), result.followupSeeded.nextDate);
    assert.equal(result.followupSeeded?.seeded, true);
  } finally {
    rmSync(fresh, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a repair skips status text that was copied into Notes', () => {
  const dated = northwind('Applied 2026-01-02 via referral', 'Applied 2026-09-20');
  const fromNotes = northwind('Evaluated', 'Applied 2026-09-20');
  const fromCell = northwind('Evaluated');
  try {
    const first = jsonOf(setStatus(dated, ['--row', '7', 'Applied', '--json']));
    assert.equal(first.followupSeeded?.seeded, true, JSON.stringify(first.followupSeeded));
    rmSync(followups(dated), { force: true });
    const repair = jsonOf(setStatus(dated, ['--row', '7', 'Applied', '--repair-followup', '--json']));
    const noted = jsonOf(setStatus(fromNotes, ['--row', '7', 'Applied', '--json']));
    const january = jsonOf(setStatus(fromCell, ['--row', '7', 'Applied', '--on', '2026-01-02', '--json']));
    assert.equal(repair.followupSeeded?.seeded, true, JSON.stringify(repair.followupSeeded));
    assert.equal(pinDate(dated), noted.followupSeeded.nextDate);
    assert.notEqual(pinDate(dated), january.followupSeeded.nextDate);
    assert.match(rowLine(dated), /Applied 2026-01-02 via referral/);
  } finally {
    for (const dir of [dated, fromNotes, fromCell]) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a repair of an older copied line still prefers the later notes date', () => {
  const dated = northwind('Applied', 'Applied 2026-01-02 via referral; Applied 2026-09-20');
  const fromNotes = northwind('Evaluated', 'Applied 2026-09-20');
  const authoredFirst = northwind('Applied', 'Applied 2026-01-02 via referral; Applied 2026-09-20');
  const january = northwind('Evaluated');
  try {
    writeFileSync(join(dated, 'data', 'status-log.tsv'), '7\t2026-11-01\tApplied\tApplied\tset-status\t\n');
    writeFileSync(join(authoredFirst, 'data', 'status-log.tsv'), '7\t2026-11-01\tEvaluated\tApplied\tset-status\t\n');
    const repair = jsonOf(setStatus(dated, ['--row', '7', 'Applied', '--repair-followup', '--json']));
    const noted = jsonOf(setStatus(fromNotes, ['--row', '7', 'Applied', '--json']));
    const kept = jsonOf(setStatus(authoredFirst, ['--row', '7', 'Applied', '--repair-followup', '--json']));
    const fromCell = jsonOf(setStatus(january, ['--row', '7', 'Applied', '--on', '2026-01-02', '--json']));
    assert.equal(repair.followupSeeded.nextDate, noted.followupSeeded.nextDate);
    assert.equal(kept.followupSeeded.nextDate, fromCell.followupSeeded.nextDate);
  } finally {
    for (const dir of [dated, fromNotes, authoredFirst, january]) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('--replace-note is the pin date, and the note it removed is not', () => {
  const replaced = northwind('Evaluated', 'Applied 2026-08-01');
  const direct = northwind('Evaluated', 'Applied 2026-09-20');
  try {
    const result = jsonOf(setStatus(replaced, [
      '--row', '7', 'Applied', '--replace-note', 'Applied 2026-08-01', '--note', 'Applied 2026-09-20', '--json',
    ]));
    const noted = jsonOf(setStatus(direct, ['--row', '7', 'Applied', '--json']));
    assert.equal(result.followupSeeded?.seeded, true, JSON.stringify(result.followupSeeded));
    assert.equal(result.followupSeeded.nextDate, noted.followupSeeded.nextDate);
    assert.equal(logDate(replaced), localToday());
    assert.match(rowLine(replaced), /Applied 2026-09-20/);
    assert.doesNotMatch(rowLine(replaced), /2026-08-01/);
  } finally {
    rmSync(replaced, { recursive: true, force: true, maxRetries: 10 });
    rmSync(direct, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('--on wins over the day already on an Applied cell', () => {
  const dated = northwind('Applied 2026-01-02');
  const explicit = northwind('Evaluated');
  try {
    const rewritten = jsonOf(setStatus(dated, ['--row', '7', 'Applied', '--on', '2026-03-15', '--json']));
    const fromOn = jsonOf(setStatus(explicit, ['--row', '7', 'Applied', '--on', '2026-03-15', '--json']));
    assert.equal(statusCell(dated), 'Applied');
    assert.equal(logDate(dated), '2026-03-15');
    assert.equal(pinDate(dated), fromOn.followupSeeded.nextDate);
    assert.equal(rewritten.followupSeeded.nextDate, fromOn.followupSeeded.nextDate);
  } finally {
    rmSync(dated, { recursive: true, force: true, maxRetries: 10 });
    rmSync(explicit, { recursive: true, force: true, maxRetries: 10 });
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
