// tests/outcome-tracker-local-dates.test.mjs — the outcome journal and the
// tracker's status-event table stamp the LOCAL calendar day, not the UTC one
// (#3070).
//
// tests/local-today-gates.test.mjs scoped itself to places that "GATE a
// decision rather than stamping a filename", and included assessment-log.mjs
// for "the date written into a user's assessments.tsv row". These two write
// exactly that kind of date and were both on `new Date().toISOString()`:
//
//   outcome.mjs:62    the `## Entry:` header and `**Date**:` in data/outcomes/,
//                     which calibrate.mjs and funnel-velocity.mjs then read
//   tracker.mjs:552   the date on a row in the SQLite status_events table
//
// The tracker one sticks: the index is derived and rebuildable, but its own
// comment says events "persist across rebuilds, keyed by id", so a wrong day is
// written once and never corrected by a resync.
//
// FROZEN INSTANT, not the wall clock — the same discipline as the gate file, and
// for the same reason it records: the window where the UTC day and the local day
// disagree exists for only part of the UTC day, so a test reading `new Date()`
// passes for most of the day whether the bug is present or not.
//
// Run:  node --test tests/outcome-tracker-local-dates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 01:30 UTC on the 18th is still the 17th everywhere west of Greenwich.
const INSTANT = '2026-08-18T01:30:00Z';
const UTC_DAY = '2026-08-18';
const NY_DAY = '2026-08-17';

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-acme-2026-01-05.md) | n |',
  '',
].join('\n');

// A --import preload that freezes Date, then the real script as the entry
// point. tests/scan-ats-full-outage-checkpoint.test.mjs uses the same shape.
//
// --import rather than a wrapper that imports the target: isMainModule()
// compares import.meta.url against the process entry path, so a wrapper entry
// makes every one of these scripts decide it is a library and skip its CLI body
// — a silent exit 0 that looks like the command ran and did nothing. With
// --import the preload runs first and the script is still argv[1].
function freezeFile(dir) {
  const file = join(dir, 'freeze-clock.mjs');
  writeFileSync(file, `
const RealDate = Date;
const FROZEN = new RealDate(${JSON.stringify(INSTANT)});
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) { super(FROZEN.getTime()); } else { super(...a); } }
  static now() { return FROZEN.getTime(); }
};
`);
  return pathToFileURL(file).href;
}

function runFrozen(dir, scriptRel, args, dataRoot) {
  const r = spawnSync(process.execPath, ['--import', freezeFile(dir), join(ROOT, scriptRel), ...args], {
    cwd: dataRoot, encoding: 'utf-8', timeout: 60_000,
    env: {
      ...process.env,
      TZ: 'America/New_York',
      CAREER_OPS_ROOT: dataRoot,
      CAREER_OPS_DATA_DIR: '',
    },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-localdate-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  writeFileSync(join(dir, 'reports', '001-acme-2026-01-05.md'), '# Acme\n\n**Score:** 4.2/5\n');
  return dir;
}

test('the premise: at this instant the UTC day and the New York day differ', () => {
  // Without this the rest measures nothing — it is the whole reason the instant
  // is pinned rather than read from the clock.
  assert.notEqual(UTC_DAY, NY_DAY);
});

test('outcome.mjs journals the local day', () => {
  const dir = sandbox();
  try {
    const r = runFrozen(dir, 'outcome.mjs', ['1', 'rejected'], dir);
    const outcomesDir = join(dir, 'data', 'outcomes');
    assert.ok(existsSync(outcomesDir), `no outcome journal was written:\n${r.all.slice(0, 500)}`);
    // outcome.mjs writes data/outcomes/<slug>/outcome.md — a directory per
    // outcome, not loose files — so collect one level down.
    const journals = readdirSync(outcomesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => readdirSync(join(outcomesDir, e.name))
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(outcomesDir, e.name, f)));
    assert.ok(journals.length > 0, `outcomes/ holds no journal:\n${r.all.slice(0, 500)}`);
    const text = journals.map((f) => readFileSync(f, 'utf-8')).join('\n');
    assert.ok(
      text.includes(NY_DAY),
      `the journal carries the UTC day, not the local one. Expected ${NY_DAY}, got:\n${text.slice(0, 400)}`,
    );
    assert.ok(
      !text.includes(UTC_DAY),
      `the UTC day ${UTC_DAY} still appears in the journal:\n${text.slice(0, 400)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('tracker.mjs dates its status events with the local day', async () => {
  // node:sqlite needs Node >= 22.5; skip rather than fail on an older runtime,
  // the way test-all does for the tracker index suites. Probed in-process, so
  // this file contains no process.exit literal — tests/main-guard-convention
  // greps discovered suites for one and does not care that it is inside a
  // subprocess argument.
  try {
    await import('node:sqlite');
  } catch {
    return;   // node:sqlite unavailable
  }

  const dir = sandbox();
  try {
    // TWO syncs with a status change between them. `today` is only reached on a
    // TRANSITION — a first sync dates the event from the row's own Date column
    // (`DATE_RE.test(a.date) ? a.date : today`), so a single sync never touches
    // the clock and a test built on one measures nothing. That is exactly how
    // the first draft of this passed with the fix reverted.
    runFrozen(dir, 'tracker.mjs', ['sync'], dir);
    writeFileSync(join(dir, 'data', 'applications.md'), TRACKER.replace('| Applied |', '| Interview |'));
    const r = runFrozen(dir, 'tracker.mjs', ['sync'], dir);
    const dbPath = join(dir, 'data', 'applications.db');
    assert.ok(existsSync(dbPath), `no index was built:\n${r.all.slice(0, 500)}`);

    const q = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      const rows = db.prepare('SELECT date FROM status_events').all();
      process.stdout.write(JSON.stringify(rows.map(r => r.date)));
    `], { encoding: 'utf-8', timeout: 30_000 });
    assert.equal(q.status, 0, `could not read status_events: ${q.stderr}`);
    const dates = JSON.parse(q.stdout);
    assert.ok(
      !dates.includes(UTC_DAY),
      `a status event was dated with the UTC day (${UTC_DAY}): ${JSON.stringify(dates)}. `
      + 'These persist across rebuilds keyed by id, so a wrong day is written once and sticks.',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
