// tests/close-stale.test.mjs — close-stale.mjs closes long-silent Applied rows in
// bulk, dry-run by default, through the locked/atomic tracker write path (#5794).
//
// Every case runs the REAL CLI against a fixture tracker in a temp data root, with
// a fixed --today. Nothing reads the wall clock for a date, so the suite gives the
// same answer on any runner; one case reruns the same fixture under three
// timezones to pin that. No real user data is used or copied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openTrackerTransaction } from '../tracker-utils.mjs';
import { parseStatusLog } from '../funnel-velocity.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';
import { daysBetween, isoMinusDays, noteTag, classifyRows } from '../close-stale.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'close-stale.mjs');
const TODAY = '2026-10-24';
// With --days 60 and TODAY above: 2026-08-25 is exactly 60 days old (kept),
// 2026-08-24 is 61 days old (closed).
const D60 = '2026-08-25';
const D61 = '2026-08-24';
const OLD = '2026-06-01';

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|';
const row = (n, date, company, status, notes = '') =>
  `| ${n} | ${date} | ${company} | Engineer | 4.0/5 | ${status} | ✅ | [${n}](reports/${String(n).padStart(3, '0')}-x.md) | ${notes} |`;
const trackerText = (rows) => ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n');

function makeRoot(rows, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'close-stale-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, trackerText(rows));
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(root, 'data', name), content);
  return { root, tracker, log: join(root, 'data', 'status-log.tsv'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(root, args = [], env = {}) {
  const cleanEnv = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_FOLLOWUPS: '', ...env };
  const r = spawnSync(process.execPath, [SCRIPT, ...(args.includes('--today') ? [] : ['--today', TODAY]), ...args], { encoding: 'utf-8', env: cleanEnv });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* summary mode or error */ }
  return { ...r, json };
}

const withRoot = (rows, extra, fn) => {
  const fx = makeRoot(rows, extra);
  try { return fn(fx); } finally { fx.cleanup(); }
};

const closedNums = (json) => json.candidates.map((c) => c.num).sort((a, b) => a - b);
const lineFor = (text, n) => text.split('\n').find((l) => new RegExp(`^\\|\\s*${n}\\s*\\|`).test(l));

test('dry run is the default and writes nothing', () => {
  withRoot([row(1, OLD, 'Old Co', 'Applied')], {}, ({ tracker, log, root }) => {
    const before = readFileSync(tracker, 'utf-8');
    const r = run(root);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(r.json.metadata.confirm, false);
    assert.equal(r.json.metadata.candidates, 1);
    assert.equal(r.json.metadata.closed, 0);
    assert.equal(readFileSync(tracker, 'utf-8'), before, 'tracker must be byte-identical');
    assert.equal(existsSync(log), false, 'no status-log line in a dry run');
    assert.deepEqual(readdirSync(join(root, 'data')).sort(), ['applications.md']);
  });
});

test('cutoff boundary: exactly --days old is kept, one day older is closed', () => {
  withRoot([row(1, D60, 'Edge Co', 'Applied'), row(2, D61, 'Edge Two', 'Applied')], {}, ({ root }) => {
    const r = run(root);
    assert.deepEqual(closedNums(r.json), [2]);
    assert.equal(r.json.metadata.recent, 1);
    assert.equal(r.json.metadata.cutoff, D60);
  });
});

test('--days moves the cutoff', () => {
  withRoot([row(1, '2026-09-01', 'A', 'Applied'), row(2, '2026-10-01', 'B', 'Applied')], {}, ({ root }) => {
    assert.deepEqual(closedNums(run(root, ['--days', '30']).json), [1]);
    assert.deepEqual(closedNums(run(root, ['--days=10']).json), [1, 2]);
    assert.deepEqual(closedNums(run(root).json), []);
  });
});

test('only Applied rows are touched; every other state is left alone', () => {
  const states = ['Evaluated', 'Responded', 'Assessment', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP'];
  const rows = states.map((s, i) => row(i + 1, OLD, `Co${i}`, s));
  rows.push(row(20, OLD, 'AliasCo', 'Sent'), row(21, OLD, 'BoldCo', '**Applied**'));
  withRoot(rows, {}, ({ tracker, root }) => {
    const before = readFileSync(tracker, 'utf-8');
    const r = run(root, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.deepEqual(closedNums(r.json), [20, 21], 'status aliases resolve through states.yml');
    const after = readFileSync(tracker, 'utf-8');
    for (let n = 1; n <= states.length; n++) assert.equal(lineFor(after, n), lineFor(before, n), `row ${n} untouched`);
  });
});

test('later signals skip a row: active interview, status-log transition, open follow-up', () => {
  const rows = [
    row(1, OLD, 'Plain Co', 'Applied'),
    row(2, OLD, 'Interview Co', 'Applied'),
    row(3, OLD, 'Responded Co', 'Applied'),
    row(4, OLD, 'Pinged Co', 'Applied'),
    row(5, OLD, 'Pinned Co', 'Applied'),
    row(6, OLD, 'Seeded Pin Co', 'Applied'),
    row(7, OLD, 'Retired Co', 'Applied'),
  ];
  const extra = {
    'active-interviews.md': [
      '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
      '|---|---|---|---|---|---|---|',
      '| Interview Co. | A different role title | 1 | 2026-06-10 | x | Done | |',
      '',
    ].join('\n'),
    'status-log.tsv': [
      `3\t${OLD}\tEvaluated\tApplied\tset-status\t`,
      '3\t2026-07-01\tApplied\tResponded\tset-status\t',
      '',
    ].join('\n'),
    'follow-ups.md': [
      '- 2026-10-10 · #4 Pinged Co — sent a nudge',
      '- next #5 2026-11-02 (set 2026-10-20)',
      '- next #6 2026-06-08 (set 2026-06-01)',
      '- next #7 2026-11-02 (set 2026-10-20)',
      '- cleared #7 2026-10-21 — no contact',
      '',
    ].join('\n'),
  };
  withRoot(rows, extra, ({ root }) => {
    const r = run(root);
    assert.deepEqual(closedNums(r.json), [1, 6, 7].sort((a, b) => a - b), JSON.stringify(r.json.skipped));
    const reasons = Object.fromEntries(r.json.skipped.map((s) => [s.num, s.reason]));
    assert.deepEqual(reasons, { 2: 'active-interview', 3: 'status-log', 4: 'open-follow-up', 5: 'open-follow-up' });
  });
});

test('an active interview under another legal form of the company still skips the row', () => {
  const rows = [
    row(1, OLD, 'Kestrel Payments', 'Applied'),
    row(2, OLD, 'Copperline Freight, Inc.', 'Applied'),
    row(3, OLD, 'Kestrel Robotics', 'Applied'),
  ];
  const extra = {
    'active-interviews.md': [
      '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
      '|---|---|---|---|---|---|---|',
      '| Kestrel Payments Inc. | Analyst | 1 | 2026-10-20 | x | Scheduled | |',
      '| Copperline Freight | Analyst | 2 | 2026-10-21 | x | Scheduled | |',
      '',
    ].join('\n'),
  };
  withRoot(rows, extra, ({ root }) => {
    const r = run(root);
    assert.deepEqual(closedNums(r.json), [3]);
    assert.deepEqual(r.json.skipped.map((s) => [s.num, s.reason]), [[1, 'active-interview'], [2, 'active-interview']]);
  });
});

test('age is measured from the latest of Date, an Applied date in Notes and the ledger', () => {
  const rows = [
    row(1, OLD, 'Notes Co', 'Applied', 'Applied 2026-10-15 via Ashby'),
    row(2, OLD, 'Ledger Co', 'Applied'),
    row(3, OLD, 'Plain Co', 'Applied', 'Applied 2026-06-02'),
  ];
  const extra = { 'status-log.tsv': '2\t2026-10-01\tEvaluated\tApplied\tset-status\t\n' };
  withRoot(rows, extra, ({ root }) => {
    const r = run(root);
    assert.deepEqual(closedNums(r.json), [3]);
    assert.equal(r.json.metadata.recent, 2);
  });
});

test('a row whose # is shared is skipped, never guessed', () => {
  withRoot([row(1, OLD, 'Dup A', 'Applied'), row(1, OLD, 'Dup B', 'Applied')], {}, ({ root }) => {
    const r = run(root);
    assert.deepEqual(closedNums(r.json), []);
    assert.deepEqual(r.json.skipped.map((s) => s.reason), ['duplicate-num', 'duplicate-num']);
  });
});

test('--confirm writes status, note tag and one status-log line per row; only those rows change', () => {
  const rows = [row(1, OLD, 'Old Co', 'Applied', 'sent by email'), row(2, D61, 'Edge Co', 'Applied'), row(3, D60, 'Keep Co', 'Applied')];
  withRoot(rows, {}, ({ tracker, log, root }) => {
    const before = readFileSync(tracker, 'utf-8');
    const r = run(root, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(r.json.metadata.closed, 2);
    const after = readFileSync(tracker, 'utf-8');
    const tag = noteTag(TODAY, 60);
    assert.equal(tag, 'no response (auto-closed 2026-10-24, 60d)');
    assert.equal(lineFor(after, 1), row(1, OLD, 'Old Co', 'Discarded', `sent by email; ${tag}`));
    assert.equal(lineFor(after, 2), row(2, D61, 'Edge Co', 'Discarded', tag));
    assert.equal(lineFor(after, 3), lineFor(before, 3));
    assert.equal(after.split('\n').length, before.split('\n').length, 'no row added or removed');
    assert.equal(readFileSync(log, 'utf-8'), `1\t${TODAY}\tApplied\tDiscarded\tclose-stale\t60d\n2\t${TODAY}\tApplied\tDiscarded\tclose-stale\t60d\n`);
    // The tracker write is an atomic replace: no temp file or lock directory is left behind.
    assert.deepEqual(readdirSync(join(root, 'data')).sort(), ['applications.md', 'status-log.tsv']);
  });
});

test('re-running --confirm changes nothing (idempotent)', () => {
  withRoot([row(1, OLD, 'Old Co', 'Applied')], {}, ({ tracker, log, root }) => {
    assert.equal(run(root, ['--confirm']).json.metadata.closed, 1);
    const trackerAfterFirst = readFileSync(tracker, 'utf-8');
    const logAfterFirst = readFileSync(log, 'utf-8');
    const second = run(root, ['--confirm']);
    assert.equal(second.status, 0, describeSpawn(second));
    assert.equal(second.json.metadata.closed, 0);
    assert.equal(readFileSync(tracker, 'utf-8'), trackerAfterFirst);
    assert.equal(readFileSync(log, 'utf-8'), logAfterFirst);
    // A day later, still nothing: the note tag is not stacked.
    const later = spawnSync(process.execPath, [SCRIPT, '--today', '2026-10-25', '--confirm'], {
      encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
    });
    assert.equal(later.status, 0, describeSpawn(later));
    assert.equal(readFileSync(tracker, 'utf-8'), trackerAfterFirst);
  });
});

test('a row the user reopened after an auto-close is not closed again', () => {
  const tag = noteTag('2026-09-30', 60);
  withRoot([row(1, OLD, 'Back Co', 'Applied', `reply came in; ${tag}`)], {}, ({ root }) => {
    const r = run(root, ['--confirm']);
    assert.equal(r.json.metadata.closed, 0);
    assert.equal(r.json.skipped[0].reason, 'previously-auto-closed');
  });
  withRoot([row(1, OLD, 'Back Co', 'Applied')], { 'status-log.tsv': `1\t2026-06-20\tApplied\tDiscarded\tclose-stale\t60d\n1\t2026-06-25\tDiscarded\tApplied\tset-status\t\n` }, ({ root }) => {
    assert.equal(run(root).json.skipped[0].reason, 'previously-auto-closed');
  });
});

test('--status is validated against states.yml and resolves aliases', () => {
  withRoot([row(1, OLD, 'Old Co', 'Applied')], {}, ({ tracker, root }) => {
    const before = readFileSync(tracker, 'utf-8');
    for (const bad of ['Bogus', 'Applied']) {
      const r = run(root, ['--status', bad, '--confirm']);
      assert.equal(r.status, 2, describeSpawn(r, `--status ${bad} must be refused`));
      assert.equal(readFileSync(tracker, 'utf-8'), before);
    }
    const ok = run(root, ['--status', 'rechazado', '--confirm']);
    assert.equal(ok.status, 0, describeSpawn(ok));
    assert.equal(ok.json.metadata.targetStatus, 'Rejected');
    assert.match(lineFor(readFileSync(tracker, 'utf-8'), 1), /\| Rejected \|/);
  });
});

test('bad --days / --today / unknown flags fail without touching the tracker', () => {
  withRoot([row(1, OLD, 'Old Co', 'Applied')], {}, ({ tracker, root }) => {
    const before = readFileSync(tracker, 'utf-8');
    for (const args of [['--days', '0'], ['--days', 'abc'], ['--days', '-5'], ['--today', '2026-13-45'], ['--confirm', '--dryrun'], ['--json', '--summary']]) {
      const r = run(root, args);
      assert.ok(exitedNonZero(r), describeSpawn(r, `${args.join(' ')} must fail`));
      assert.equal(readFileSync(tracker, 'utf-8'), before);
    }
  });
});

test('--summary prints counts and a sample', () => {
  withRoot([row(1, OLD, 'Old Co', 'Applied'), row(2, OLD, 'Interview Co', 'Applied')], {
    'active-interviews.md': '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |\n|---|---|---|---|---|---|---|\n| Interview Co | X | 1 | 2026-06-01 | x | Done | |\n',
  }, ({ root }) => {
    const r = run(root, ['--summary']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /dry run/);
    assert.match(r.stdout, /Would close -> Discarded:\s+1/);
    assert.match(r.stdout, /active-interview: 1/);
    assert.match(r.stdout, /Old Co/);
  });
});

test('a held tracker lock blocks --confirm and leaves the tracker untouched', async () => {
  const fx = makeRoot([row(1, OLD, 'Old Co', 'Applied')]);
  const tx = await openTrackerTransaction(fx.tracker);
  try {
    const before = readFileSync(fx.tracker, 'utf-8');
    const r = run(fx.root, ['--confirm'], { CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '300', CAREER_OPS_TRACKER_LOCK_RETRY_MS: '25' });
    assert.equal(r.status, 4, describeSpawn(r, `expected the lock-timeout exit code, got ${r.status}`));
    assert.equal(readFileSync(fx.tracker, 'utf-8'), before);
    assert.equal(existsSync(fx.log), false);
    // A dry run takes no lock, so it still answers while a writer holds it.
    assert.equal(run(fx.root).status, 0);
  } finally {
    tx.close();
    fx.cleanup();
  }
});

test('the lock is released after --confirm, so a second writer is not blocked', async () => {
  const fx = makeRoot([row(1, OLD, 'Old Co', 'Applied')]);
  try {
    assert.equal(run(fx.root, ['--confirm']).status, 0);
    const tx = await openTrackerTransaction(fx.tracker, { timeoutMs: 500 });
    tx.close();
  } finally {
    fx.cleanup();
  }
});

test('day math is independent of the host timezone', () => {
  withRoot([row(1, D60, 'Edge Co', 'Applied'), row(2, D61, 'Edge Two', 'Applied')], {}, ({ root }) => {
    const outputs = ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((TZ) => {
      const r = run(root, [], { TZ });
      assert.equal(r.status, 0, describeSpawn(r));
      return JSON.stringify(r.json.candidates);
    });
    assert.equal(new Set(outputs).size, 1, 'every timezone must pick the same rows');
    assert.deepEqual(JSON.parse(outputs[0]).map((c) => c.num), [2]);
  });
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2, 'across a DST change');
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(isoMinusDays('2026-03-09', 60), '2026-01-08');
});

test('close-stale is a member of the status-log source set and kept out of day-math', () => {
  const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
  const { observations, unknownSources, unparseable } = parseStatusLog(`1\t${TODAY}\tApplied\tDiscarded\tclose-stale\t60d\n`, states);
  assert.deepEqual(unknownSources, []);
  assert.deepEqual(unparseable, []);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].dayMath, false, 'a declared silence is not an observed hop');
});

test('classifyRows is pure: the same input classifies the same way', () => {
  const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
  const md = trackerText([row(1, OLD, 'Old Co', 'Applied'), row(2, OLD, 'Done Co', 'Rejected')]);
  const a = classifyRows(md, { today: TODAY, days: 60, states });
  const b = classifyRows(md, { today: TODAY, days: 60, states });
  assert.deepEqual(a.candidates, b.candidates);
  assert.equal(a.appliedRows, 1);
});

test('a tracker that cannot be read fails cleanly and releases the lock', async () => {
  const fx = makeRoot([row(1, OLD, 'Old Co', 'Applied')]);
  try {
    // Replace the tracker file with a directory: it exists, but reading it fails.
    rmSync(fx.tracker);
    mkdirSync(fx.tracker);
    const r = run(fx.root, ['--confirm'], { CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '500' });
    assert.equal(r.status, 2, describeSpawn(r));
    assert.equal(existsSync(fx.log), false);
    const tx = await openTrackerTransaction(fx.tracker, { timeoutMs: 500 });
    tx.close();
    const dry = run(fx.root);
    assert.equal(dry.status, 2, describeSpawn(dry, 'a dry-run read error is reported, not a stack trace'));
    assert.doesNotMatch(dry.stderr, /at .*node:internal/);
  } finally {
    fx.cleanup();
  }
});
