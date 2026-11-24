// tests/calibrate-ledger-path.test.mjs — calibrate reads the status-log.tsv
// beside the tracker, the one every writer appends to.
//
// loadLedgerReached() opened <workspace>/data/status-log.tsv. set-status,
// dedup-tracker and close-stale write the ledger beside the tracker
// (lib/status-hooks.mjs statusLogPath()), and the other readers, including
// loadClosedNoResponse() in calibrate itself, open it there. The two paths agree
// only for the default data/applications.md. With CAREER_OPS_TRACKER elsewhere,
// or the documented root-level applications.md fallback, calibrate found no
// ledger, so a row that reached Interview before it was rejected counted as no
// interview in its score band.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

// Two rejected rows in the >=4.5 band; the ledger says #1 reached Interview first.
const TRACKER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|---|---|---|---|---|---|---|---|\n'
  + '| 1 | 2026-09-01 | Acme Corp | Backend Engineer | 4.6/5 | Rejected | ❌ | - | |\n'
  + '| 2 | 2026-09-02 | Globex | Data Engineer | 4.7/5 | Rejected | ❌ | - | |\n';
const LEDGER = '1\t2026-09-10\tApplied\tInterview\tset-status\t\n1\t2026-09-20\tInterview\tRejected\tset-status\t\n';

// `tracker` is the tracker's path relative to the data root; `override` sets
// CAREER_OPS_TRACKER to it instead of leaving resolution to the defaults.
function topBand(tracker, { override = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'calibrate-ledger-'));
  dirs.push(root);
  const trackerPath = join(root, tracker);
  mkdirSync(dirname(trackerPath), { recursive: true });
  writeFileSync(trackerPath, TRACKER);
  writeFileSync(join(dirname(trackerPath), 'status-log.tsv'), LEDGER);
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  if (override) env.CAREER_OPS_TRACKER = trackerPath;
  const r = spawnSync(NODE, [join(ROOT, 'calibrate.mjs'), '--json', '--min-band-n', '1'], { cwd: root, env, encoding: 'utf-8', timeout: 30000 });
  assert.equal(r.status, 0, describeSpawn(r));
  return JSON.parse(r.stdout).bands.find((b) => b.band === '>=4.5');
}

test('a tracker set with CAREER_OPS_TRACKER outside data/ keeps its ledger evidence', () => {
  assert.deepEqual({ ...topBand('jobs/tracker.md', { override: true }) }, { band: '>=4.5', n: 2, interviews: 1, offers: 0, interviewRate: 50, offerRate: 0 });
});

test('a root-level applications.md keeps its ledger evidence', () => {
  assert.equal(topBand('applications.md').interviews, 1);
});

test('the default data/applications.md reads the same ledger as before', () => {
  assert.equal(topBand('data/applications.md').interviews, 1);
});
