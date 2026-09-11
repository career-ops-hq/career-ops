// tests/scan-runs-reader-agreement.test.mjs — data/scan-runs.tsv has one writer
// and one reader, and the pair has to agree (#1604, #3510).
//
// #3511 anchored the scanners' user data to the data root and pinned it well,
// including that appendScanRunSummary() writes under the data root. This adds
// the half that check cannot make: it asserts where the WRITER puts the file,
// never asking stats.mjs where it actually looks. Move stats.mjs's own constant
// and tests/scan-data-paths-under-data-root.test.mjs stays green — verified —
// because from the writer's side nothing has changed.
//
// That is worth its own assertion because the two sides are resolved
// independently, in different files, and the failure is invisible: an absent
// counter file is indistinguishable from never having scanned, so `stats`
// reports empty scan-run trends exactly as it would for a fresh install.
//
// Written as a ROUND TRIP through both public entry points on their DEFAULT
// paths, so it keeps holding if either side's resolution is rewritten again.
//
// Run:  node --test tests/scan-runs-reader-agreement.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const url = (rel) => JSON.stringify(pathToFileURL(join(ROOT, rel)).href);

const COUNTERS = {
  timestamp: '2026-09-02T09:00:00.000Z', status: 'completed',
  companies: 12, boards: 12, found: 40,
  filteredTitle: 3, filteredTier: 1, filteredLocation: 2, filteredPostingAge: 0,
  filteredSalary: 0, filteredContent: 1, filteredCooldown: 0,
  dupes: 5, newAdded: 28, errors: 0,
  filteredBlacklist: 0, filteredVisa: 0, filteredPostedDate: 0,
  filteredCountryEligibility: 0,
};

// cwd is deliberately NOT the data root, matching #3511's arrangement — a check
// that runs from the data root cannot tell the two resolutions apart.
function roundTrip() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-runsroot-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-runsdecoy-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(decoyCwd, 'data'), { recursive: true });
  try {
    const script = `
      const scan  = await import(${url('scan.mjs')});
      const stats = await import(${url('stats.mjs')});
      scan.appendScanRunSummary(${JSON.stringify(COUNTERS)});   // default path
      const all = stats.computeAllStats();                       // default path
      process.stdout.write(JSON.stringify({ runs: all.runs ?? null }));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: decoyCwd, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    assert.equal(r.status, 0, `child exited ${r.status}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    for (const d of [dataRoot, decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('a run scan.mjs just wrote is visible to stats.mjs', () => {
  const out = roundTrip();
  assert.ok(
    out.runs,
    'stats.mjs found no scan runs at all — the counters appendScanRunSummary() just wrote '
    + 'are not where computeAllStats() looks. The two constants are resolved in separate '
    + 'files, so either side can drift without the other noticing.',
  );
  assert.equal(
    out.runs.totalRuns ?? out.runs.runs ?? 0,
    1,
    `stats.mjs did not see the appended run: ${JSON.stringify(out.runs)}`,
  );
});
