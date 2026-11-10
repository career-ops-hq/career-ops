// tests/dedup-tracker-req-conflict.test.mjs — two different requisition ids in
// Notes block dedup (#1524).
//
// merge-tracker.mjs treats two present-and-different req/job ids in the Notes
// column as proof that two rows are distinct openings (`reqNumDiffers`, #1524),
// and dedup-tracker.mjs already applies the posting-URL half of that rule
// (#4562). The req-id half was missing: an employer that posts one title once
// per city or country gives each copy its own job id, merge-tracker keeps the
// rows apart on purpose, and dedup-tracker then deleted the lower-scored one.
//
// Drives the REAL dedup-tracker.mjs CLI against a temp tracker via the
// CAREER_OPS_TRACKER hook, because the deletion is what loses data — asserting
// on the rows left in the tracker is what proves the guard.
import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const HEADER_URL = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP_URL = '|---|---|---|---|---|---|---|---|---|---|';

function withTracker(header, sep, rows, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-req-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', header, sep, ...rows, ''].join('\n'));
    execFileSync(process.execPath, [DEDUP], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    fn(dataRows(readFileSync(tracker, 'utf-8')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function dataRows(text) {
  return text.split('\n').filter(l => l.startsWith('|')
    && !/^\|[\s|:-]+\|\s*$/.test(l)
    && !/^\|\s*#\s*\|/.test(l));
}

// The # cell of each surviving row, so a failure names which row was deleted.
const nums = (rows) => rows.map(r => r.split('|')[1].trim()).sort();

ok('same company + title with two different job ids: both rows survive', () => {
  withTracker(HEADER, SEP, [
    '| 1 | 2026-09-17 | ExampleCorp | Senior ML Engineer | 1.4/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-09-17.md) | Job id 8157736. US remote |',
    '| 2 | 2026-09-17 | ExampleCorp | Senior ML Engineer | 1.0/5 | Evaluated | ❌ | [2](reports/002-examplecorp-2026-09-17.md) | Job id 8157738. Canada remote |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2'], 'different req ids are proof of two openings');
  });
});

ok('the same job id still merges (the higher score is kept)', () => {
  withTracker(HEADER, SEP, [
    '| 1 | 2026-09-17 | ExampleCorp | Senior ML Engineer | 1.4/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-09-17.md) | Job id 8157736. first |',
    '| 2 | 2026-09-18 | ExampleCorp | Senior ML Engineer | 1.0/5 | Evaluated | ❌ | [2](reports/002-examplecorp-2026-09-18.md) | Job id 8157736. rescored |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('an id on one side only is unknown, not a conflict — the rows still merge', () => {
  withTracker(HEADER, SEP, [
    '| 1 | 2026-09-17 | ExampleCorp | Senior ML Engineer | 1.4/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-09-17.md) | Job id 8157736. first |',
    '| 2 | 2026-09-18 | ExampleCorp | Senior ML Engineer | 1.0/5 | Evaluated | ❌ | [2](reports/002-examplecorp-2026-09-18.md) | remote |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('every Notes spelling the shared extractor supports blocks the merge', () => {
  // One pair per company, so each pair is judged on its own. The spellings are
  // the ones tracker-parse.mjs documents: R_<n>, Req <alnum>, Req #<n>,
  // REQ-<year>-<n>, Job ID <n>, Posting ID <n>.
  withTracker(HEADER, SEP, [
    '| 1 | 2026-09-17 | AlphaCo | Data Analyst | 3.0/5 | Evaluated | ❌ | [1](reports/001-alphaco-2026-09-17.md) | R_1494379 |',
    '| 2 | 2026-09-17 | AlphaCo | Data Analyst | 2.0/5 | Evaluated | ❌ | [2](reports/002-alphaco-2026-09-17.md) | R_1488728 |',
    '| 3 | 2026-09-17 | BetaCo | Data Analyst | 3.0/5 | Evaluated | ❌ | [3](reports/003-betaco-2026-09-17.md) | Req PRACT011038 |',
    '| 4 | 2026-09-17 | BetaCo | Data Analyst | 2.0/5 | Evaluated | ❌ | [4](reports/004-betaco-2026-09-17.md) | Req PRACT011039 |',
    '| 5 | 2026-09-17 | GammaCo | Data Analyst | 3.0/5 | Evaluated | ❌ | [5](reports/005-gammaco-2026-09-17.md) | REQ-2026-32061 |',
    '| 6 | 2026-09-17 | GammaCo | Data Analyst | 2.0/5 | Evaluated | ❌ | [6](reports/006-gammaco-2026-09-17.md) | REQ-2026-32062 |',
    '| 7 | 2026-09-17 | DeltaCo | Data Analyst | 3.0/5 | Evaluated | ❌ | [7](reports/007-deltaco-2026-09-17.md) | Posting ID 5340 |',
    '| 8 | 2026-09-17 | DeltaCo | Data Analyst | 2.0/5 | Evaluated | ❌ | [8](reports/008-deltaco-2026-09-17.md) | Posting ID 5341 |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2', '3', '4', '5', '6', '7', '8']);
  });
});

ok('a URL conflict with no ids still keeps both rows (control)', () => {
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | remote | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | hybrid | https://job-boards.greenhouse.io/acme/jobs/2002 |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2']);
  });
});

ok('an id-less row cannot bridge two different ids into one cluster', () => {
  // Clustering compares each candidate with the seed row. A seed with no id
  // matches both id rows on its own, so without a check against every member
  // the two postings landed in one cluster and one was deleted.
  withTracker(HEADER, SEP, [
    '| 1 | 2026-09-17 | ExampleCorp | Senior ML Engineer | 3.5/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-09-17.md) | first |',
    '| 2 | 2026-09-18 | ExampleCorp | Senior ML Engineer | 4.2/5 | Evaluated | ❌ | [2](reports/002-examplecorp-2026-09-18.md) | Job id 8157736 |',
    '| 3 | 2026-09-19 | ExampleCorp | Senior ML Engineer | 3.8/5 | Evaluated | ❌ | [3](reports/003-examplecorp-2026-09-19.md) | Job id 8157738 |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['2', '3'], 'both postings survive; only the id-less row merges');
  });
});
