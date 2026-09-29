// tests/dedup-tracker-url-conflict.test.mjs — a posting-URL conflict blocks dedup (#4562).
//
// dedup-tracker.mjs clustered rows on company + role alone, so two rows naming
// the same role at one company but pointing at two DIFFERENT live postings were
// merged and the lower-scored one deleted. merge-tracker.mjs already treats two
// present-and-different posting URLs as proof the rows are distinct (#1524,
// #2009); dedup now asks the same question through the same normalizeUrl().
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

const HEADER_URL = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP_URL = '|---|---|---|---|---|---|---|---|---|---|';
const HEADER_NO_URL = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP_NO_URL = '|---|---|---|---|---|---|---|---|---|';

function withTracker(header, sep, rows, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-url-test-'));
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

ok('two different posting URLs for the same company + role both survive', () => {
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | req A | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | req B | https://job-boards.greenhouse.io/acme/jobs/2002 |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2'], 'a URL conflict is proof of two openings');
  });
});

ok('the same posting URL (tracking params, trailing slash, http) still merges', () => {
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | first | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | second | http://job-boards.greenhouse.io/acme/jobs/1001/?utm_source=linkedin |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1'], 'normalized-equal URLs are one posting; the higher score is kept');
  });
});

ok('a blank URL on one side is unknown, not a conflict — the rows still merge', () => {
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | first | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | second |  |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('a placeholder URL cell (N/A) is unknown, not a conflict', () => {
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | first | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | second | N/A |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('a tracker with no URL column keeps its company + role behavior', () => {
  withTracker(HEADER_NO_URL, SEP_NO_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('a URL conflict also blocks a shared report number (same order as merge-tracker)', () => {
  // merge-tracker's report-file and report-number tiers both refuse a candidate
  // whose URL conflicts (urlDiffers). Dedup follows it: two rows cannot be one
  // posting while naming two postings, whatever their report links say.
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [7](reports/007-acme-2026-09-01.md) | first | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [7](reports/007-acme-2026-09-01.md) | second | https://job-boards.greenhouse.io/acme/jobs/2002 |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2']);
  });
});

ok('a URL-less row cannot bridge two different postings into one cluster', () => {
  // Clustering compares each candidate with the seed row. A seed with no URL
  // matches both URL rows on its own, so without a check against every member
  // the two postings landed in one cluster and one was deleted.
  withTracker(HEADER_URL, SEP_URL, [
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 3.5/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | first |  |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | req A | https://job-boards.greenhouse.io/acme/jobs/1001 |',
    '| 3 | 2026-09-03 | Acme | Backend Engineer | 3.8/5 | Evaluated | ❌ | [3](reports/003-acme-2026-09-03.md) | req B | https://job-boards.greenhouse.io/acme/jobs/2002 |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['2', '3'], 'both postings survive; only the URL-less row merges');
  });
});
