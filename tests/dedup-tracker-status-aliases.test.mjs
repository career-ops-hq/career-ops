// tests/dedup-tracker-status-aliases.test.mjs — dedup-tracker.mjs ranks a status
// that is a templates/states.yml alias the same as the state it names.
//
// dedup-tracker.mjs ranks statuses from its own hardcoded table. A row whose
// Status is an alias that table does not spell ("Sent", "Aplicada", "Başvuruldu",
// "Mülakat"...) ranked 0, the same as SKIP. Two consequences, both silent:
//
//   - isAdvancedStatus() was false, so the "an Applied row is never deleted
//     because a higher-scored exact-title sibling exists" guard did not apply
//     and the in-flight application (report link, PDF flag, notes) was removed;
//   - when the rows were the same report, the more advanced alias status lost
//     the promotion contest and the keeper stayed on Evaluated.
//
// Drives the REAL dedup-tracker.mjs CLI against a temp tracker via the
// CAREER_OPS_TRACKER hook: the deletion is what loses data, so the rows left in
// the file are what is asserted.
import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';

function withTracker(rows, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-alias-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    const r = spawnSync(process.execPath, [DEDUP], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    assert.equal(r.status, 0, `dedup-tracker exited ${r.status}: ${r.stderr}`);
    fn(readFileSync(tracker, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cells = (row) => row.split('|').map((c) => c.trim());
const nums = (rows) => rows.map((r) => cells(r)[1]).sort();

// Aliases of states at or above Applied, each spelled the way states.yml does
// and each missing from dedup-tracker's own table.
for (const alias of ['Sent', 'Aplicada', 'Enviada', 'Başvuruldu', 'Mülakat', 'Teklif', 'TEKLİF']) {
  ok(`an exact-title duplicate is not removed when the other row's status is the alias "${alias}"`, () => {
    withTracker([
      '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | re-evaluated |',
      `| 2 | 2026-08-20 | Acme | Backend Engineer | 4.0/5 | ${alias} | ✅ | [2](reports/002-acme-2026-08-20.md) | sent by email |`,
    ], (rows) => {
      assert.deepEqual(nums(rows), ['1', '2'], 'the in-flight application must survive');
    });
  });
}

ok('the same report under an alias status promotes the keeper instead of losing the status', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | [7](reports/007-acme-2026-09-01.md) | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Mülakat | ❌ | [7](reports/007-acme-2026-09-01.md) | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
    assert.equal(cells(rows[0])[6], 'Mülakat', 'the more advanced status of the removed row is promoted');
  });
});

ok('a states.yml alias below Applied still merges as before', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Hold | ❌ | — | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('a canonical Applied row is still protected (regression guard)', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Applied | ✅ | — | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2']);
  });
});
