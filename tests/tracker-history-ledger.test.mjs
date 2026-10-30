// tests/tracker-history-ledger.test.mjs — `tracker.mjs history` reads the
// transition ledger, and deleting the index loses nothing the ledger holds
// (#5555).
//
// Before the fix, `history` read a status_events table that recorded only what
// a sync happened to see: dated with the sync day, two changes between syncs
// collapsed into one, and `rm applications.db` threw the history away while
// data/status-log.tsv, written by set-status.mjs, still had every transition.
// Now every sync rebuilds the events from the ledger (folded with
// funnel-velocity.mjs's foldObservations()), and only a status the ledger does
// not explain — a hand edit in applications.md — is kept as an observation.
//
// Run:  node --test tests/tracker-history-ledger.test.mjs

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The row from the issue's steps to reproduce.
const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-10-01 | Northwind | Backend Engineer | 4.2/5 | Evaluated | ❌ | — | fixture |',
  '',
].join('\n');

const OBSERVED = '(no ledger row; observed at sync)';

// node:sqlite needs Node >= 22.13 unflagged. Probed once, so an older runtime
// skips these suites rather than failing them, as test-all does for the index.
let sqlite = true;
try {
  await import('node:sqlite');
} catch {
  sqlite = false;
}
const SQLITE = { skip: sqlite ? false : 'node:sqlite unavailable' };

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-history-ledger-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  return {
    dir,
    tracker: join(dir, 'data', 'applications.md'),
    db: join(dir, 'data', 'applications.db'),
    ledger: join(dir, 'data', 'status-log.tsv'),
  };
}

function run(sb, script, args) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: sb.dir, encoding: 'utf-8', timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: sb.dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_TRACKER_DB: '',
    },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  assert.equal(r.status, 0, describeSpawn(r, `${script} ${args.join(' ')}`));
  return r.stdout;
}

const history = (sb) => run(sb, 'tracker.mjs', ['history', '--id', '1']);

// The event lines of a history, without the `#1 Company — Role` heading.
const events = (out) => out.split('\n').filter(l => l.startsWith('  ')).map(l => l.trim().replace(/\s+/g, ' '));

describe('tracker.mjs history: the issue\'s steps to reproduce (#5555)', SQLITE, () => {
  let sb, first, rebuilt;
  before(() => {
    sb = sandbox();
    run(sb, 'tracker.mjs', ['sync']);
    // Two changes with no sync between them, on days that are not the sync
    // day: a history dated by the sync, or collapsing the pair, cannot pass.
    run(sb, 'set-status.mjs', ['1', 'Applied', '--on', '2026-10-05']);
    run(sb, 'set-status.mjs', ['1', 'Interview', '--on', '2026-10-09']);
    first = history(sb);
    rmSync(sb.db);
    run(sb, 'tracker.mjs', ['sync']);
    rebuilt = history(sb);
  });

  test('history lists both ledger transitions, with the ledger\'s dates', () => {
    assert.deepEqual(events(first), [
      '2026-10-01 Evaluated',
      '2026-10-05 Applied',
      '2026-10-09 Interview',
    ], first);
  });

  test('deleting applications.db and syncing again gives the same history', () => {
    assert.equal(rebuilt, first);
  });

  test('the ledger the history came from is the one set-status wrote', () => {
    const lines = readFileSync(sb.ledger, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2, lines.join('\n'));
  });
});

describe('tracker.mjs history: correction and retraction lines apply', SQLITE, () => {
  test('a correction redates the transition, without any change to applications.md', () => {
    const sb = sandbox();
    try {
      run(sb, 'set-status.mjs', ['1', 'Applied', '--on', '2026-10-05']);
      run(sb, 'set-status.mjs', ['1', 'Interview', '--on', '2026-10-09']);
      assert.deepEqual(events(history(sb)).slice(1, 2), ['2026-10-05 Applied']);
      const before = readFileSync(sb.tracker, 'utf-8');

      // "The agent logged the wrong day": a later `correction` line replaces
      // the date of the earlier observation with the same to-state.
      appendFileSync(sb.ledger, '1\t2026-10-03\tEvaluated\tApplied\tcorrection\t\n');
      assert.equal(readFileSync(sb.tracker, 'utf-8'), before, 'the tracker changed, so this no longer tests ledger freshness');
      assert.deepEqual(events(history(sb)), [
        '2026-10-01 Evaluated',
        '2026-10-03 Applied',
        '2026-10-09 Interview',
      ]);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  test('a retraction removes the transition; the tracker\'s status is then unexplained', () => {
    const sb = sandbox();
    try {
      run(sb, 'set-status.mjs', ['1', 'Applied', '--on', '2026-10-05']);
      run(sb, 'set-status.mjs', ['1', 'Interview', '--on', '2026-10-09']);
      // to "-" retracts the row's latest observation: "that never happened".
      appendFileSync(sb.ledger, '1\t2026-10-10\tInterview\t-\tcorrection\t\n');
      const lines = events(history(sb));
      assert.deepEqual(lines.slice(0, 2), ['2026-10-01 Evaluated', '2026-10-05 Applied']);
      assert.equal(lines.length, 3, lines.join('\n'));
      assert.match(lines[2], /^\d{4}-\d{2}-\d{2} Interview \(no ledger row; observed at sync\)$/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true, maxRetries: 10 });
    }
  });
});

describe('tracker.mjs history: a hand edit in applications.md', SQLITE, () => {
  let sb, edited, again, withLedger, rebuilt;
  before(() => {
    sb = sandbox();
    run(sb, 'tracker.mjs', ['sync']);
    // A hand edit writes no ledger row; only the sync sees it.
    writeFileSync(sb.tracker, TRACKER.replace('| Evaluated |', '| Applied |'));
    edited = history(sb);
    run(sb, 'tracker.mjs', ['sync']);
    again = history(sb);
    // Dated today, like a real set-status run: not before the day the sync
    // saw the edit.
    run(sb, 'set-status.mjs', ['1', 'Interview']);
    withLedger = history(sb);
    rmSync(sb.db);
    run(sb, 'tracker.mjs', ['sync']);
    rebuilt = history(sb);
  });

  test('the edit is recorded and shown as unexplained by the ledger', () => {
    const lines = events(edited);
    assert.equal(lines.length, 2, edited);
    assert.equal(lines[0], '2026-10-01 Evaluated');
    assert.ok(lines[1].endsWith(`Applied ${OBSERVED}`), edited);
  });

  test('a later sync keeps that observation once, with its original date', () => {
    assert.equal(again, edited);
  });

  test('a ledger transition after the edit is added to it', () => {
    const lines = events(withLedger);
    assert.deepEqual(lines.slice(0, 2), events(edited));
    assert.equal(lines.length, 3, withLedger);
    assert.match(lines[2], /^\d{4}-\d{2}-\d{2} Interview$/);
  });

  test('a rebuilt index loses the hand edit and nothing else', () => {
    // The ledger starts from Applied, so that is where the rebuilt history
    // starts, dated with the row's Date column. Evaluated and the day of the
    // edit were known only to the deleted index.
    assert.deepEqual(events(rebuilt), ['2026-10-01 Applied', events(withLedger)[2]]);
  });
});

describe('tracker.mjs history: a hand edit reverted by hand to the ledger\'s state', SQLITE, () => {
  let sb, reverted, again;
  before(() => {
    sb = sandbox();
    run(sb, 'set-status.mjs', ['1', 'Applied', '--on', '2026-10-05']);
    run(sb, 'set-status.mjs', ['1', 'Interview', '--on', '2026-10-09']);
    run(sb, 'tracker.mjs', ['sync']);
    // Interview → Offer → Interview, both by hand: the tracker ends where the
    // ledger does, but the history must not end on Offer.
    const interview = readFileSync(sb.tracker, 'utf-8');
    writeFileSync(sb.tracker, interview.replace('| Interview |', '| Offer |'));
    run(sb, 'tracker.mjs', ['sync']);
    writeFileSync(sb.tracker, interview);
    reverted = history(sb);
    run(sb, 'tracker.mjs', ['sync']);
    again = history(sb);
  });

  test('the revert is recorded after the edit it undoes', () => {
    const lines = events(reverted);
    assert.deepEqual(lines.slice(0, 3), ['2026-10-01 Evaluated', '2026-10-05 Applied', '2026-10-09 Interview'], reverted);
    assert.equal(lines.length, 5, reverted);
    assert.ok(lines[3].endsWith(`Offer ${OBSERVED}`), reverted);
    assert.ok(lines[4].endsWith(`Interview ${OBSERVED}`), reverted);
  });

  test('a later sync keeps the revert once, with its original date', () => {
    assert.equal(again, reverted);
  });
});

describe('tracker.mjs history: an index written before #5555', SQLITE, () => {
  test('its observed events are replaced where the ledger explains them and kept where it does not', async () => {
    const sb = sandbox();
    try {
      writeFileSync(sb.tracker, TRACKER.replace('| Evaluated |', '| Offer |'));
      // The old schema: no `source` column. The first event is what the first
      // sync saw; the later ones are changes later syncs saw, sync-dated.
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(sb.db);
      db.exec(`CREATE TABLE applications (
        id INTEGER PRIMARY KEY, pos INTEGER NOT NULL, date TEXT NOT NULL,
        company TEXT NOT NULL, role TEXT NOT NULL, score TEXT NOT NULL DEFAULT '—',
        status TEXT NOT NULL, pdf TEXT NOT NULL DEFAULT '❌',
        report TEXT NOT NULL DEFAULT '—', notes TEXT NOT NULL DEFAULT '');
        CREATE TABLE status_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id INTEGER NOT NULL REFERENCES applications(id), status TEXT NOT NULL, date TEXT NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      db.prepare('INSERT INTO applications VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(1, 0, '2026-10-01', 'Northwind', 'Backend Engineer', '4.2/5', 'Offer', '❌', '—', 'fixture');
      const insert = db.prepare('INSERT INTO status_events (app_id, status, date) VALUES (?, ?, ?)');
      insert.run(1, 'Evaluated', '2026-10-01');
      insert.run(1, 'Interview', '2026-10-12'); // the sync day, not the day of the change
      insert.run(1, 'Offer', '2026-10-15');     // a hand edit: no ledger row
      db.close();
      writeFileSync(sb.ledger, [
        '1\t2026-10-05\tEvaluated\tApplied\tset-status\t',
        '1\t2026-10-09\tApplied\tInterview\tset-status\t',
        '',
      ].join('\n'));

      const out = history(sb);
      assert.deepEqual(events(out), [
        '2026-10-01 Evaluated',
        '2026-10-05 Applied',
        '2026-10-09 Interview',
        `2026-10-15 Offer ${OBSERVED}`,
      ], out);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true, maxRetries: 10 });
    }
  });
});
