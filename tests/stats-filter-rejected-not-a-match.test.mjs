// tests/stats-filter-rejected-not-a-match.test.mjs — a scan-history row that
// the user's own filters rejected is not evidence that a company produced a
// match.
//
// The scanners record what title_filter, location_filter, max_posting_age_days,
// the experience filter and scan-dayforce's content, visa and country cuts
// removed (skipped_title, skipped_location, ...), so a mis-aimed filter is
// visible. scanCompanyNames() and the --prune lastMatch loop counted those rows
// as matches: any board that returned a posting at all "produced a match", the
// coverage figure converged on 100%, and --prune never listed a company whose
// every posting the title filter rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortalRecommendations, computePortalStats, scanCompanyNames } from '../stats.mjs';
import { OBSERVATIONAL_SCAN_HISTORY_STATUSES } from '../lib/scan-history-columns.mjs';

const row = (company, status, date = '2026-07-01') =>
  `https://job-boards.greenhouse.io/${company.toLowerCase()}/jobs/1\t${date}\tgreenhouse\tEngineer\t${company}\t${status}`;
const SCAN = [
  'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
  row('Acme', 'added'),
  row('Duplo', 'skipped_dup'),
  row('Globex', 'skipped_title'),
  row('Initech', 'skipped_location'),
  row('Hooli', 'skipped_experience'),
].join('\n');
const PORTALS = 'tracked_companies:\n'
  + ['Acme', 'Duplo', 'Globex', 'Initech', 'Hooli'].map((n) => `  - name: ${n}\n    careers_url: https://job-boards.greenhouse.io/${n.toLowerCase()}\n`).join('');

test('only rows the filters kept name a producing company', () => {
  assert.deepEqual(scanCompanyNames(SCAN).sort(), ['acme', 'duplo']);
  const portals = computePortalStats(PORTALS, null, scanCompanyNames(SCAN), null);
  assert.equal(portals.producingCompanies, 2);
  assert.equal(portals.producingPct, 40);
});

test('--prune lists a reachable company whose postings the filters all rejected', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  const health = ['Acme', 'Duplo', 'Globex', 'Initech', 'Hooli']
    .flatMap((n) => [`2026-07-01\t${n}\treachable`, `2026-09-22\t${n}\treachable`]).join('\n');
  const r = computePortalRecommendations(PORTALS, SCAN, health, now);
  assert.deepEqual(r.neverProduced.map((x) => x.company), ['Globex', 'Initech', 'Hooli']);
  assert.deepEqual(r.healthyButQuiet.map((x) => x.company), ['Acme', 'Duplo']);
});

// stats.mjs reads the set from lib/scan-history-columns.mjs instead of keeping
// a copy, so every status recorded only to keep a drop visible is covered,
// skipped_no_apply_control included, and a status added there later is too.
test('no status in OBSERVATIONAL_SCAN_HISTORY_STATUSES names a producing company', () => {
  for (const status of OBSERVATIONAL_SCAN_HISTORY_STATUSES) {
    const scan = ['url\tfirst_seen\tportal\ttitle\tcompany\tstatus', row('Globex', status)].join('\n');
    assert.deepEqual(scanCompanyNames(scan), [], status);
    const health = '2026-07-01\tGlobex\treachable\n2026-09-22\tGlobex\treachable';
    const portals = 'tracked_companies:\n  - name: Globex\n    careers_url: https://job-boards.greenhouse.io/globex\n';
    const r = computePortalRecommendations(portals, scan, health, Date.parse('2026-09-22T12:00:00Z'));
    assert.deepEqual(r.neverProduced.map((x) => x.company), ['Globex'], status);
  }
});
