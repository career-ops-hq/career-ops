import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { computeAllStats } from '../stats.mjs';

const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
const trackerContent = status => header + `| 1 | 2026-06-01 | Acme | Backend Engineer | 4/5 | ${status} | - | - | |\n`;

function fixture(status) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-stats-ledger-'));
  const dataRoot = join(root, 'workspace');
  const trackerDir = join(root, 'selected-tracker');
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(trackerDir);
  const tracker = join(trackerDir, 'custom.md');
  writeFileSync(tracker, trackerContent(status));
  return { root, dataRoot, trackerDir, tracker };
}

function check(label, status, run) {
  const f = fixture(status);
  try {
    run(f);
    pass(label);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}

function cli(f, script, args = []) {
  const result = spawnSync(NODE, [join(ROOT, script), ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, CAREER_OPS_ROOT: f.dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: f.tracker },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

check('stats CLI recovers the selected tracker history written by canonical set-status', 'Applied', f => {
  cli(f, 'set-status.mjs', ['--row', '1', 'Interview', '--on', '2026-06-02', '--json']);
  cli(f, 'set-status.mjs', ['--row', '1', 'Rejected', '--on', '2026-06-03', '--json']);
  assert.match(readFileSync(join(f.trackerDir, 'status-log.tsv'), 'utf8'), /Applied\tInterview/);
  const stats = cli(f, 'stats.mjs');
  assert.equal(stats.metadata.sources.statusLog, true);
  assert.equal(stats.funnel.basis, 'ledger');
  assert.equal(stats.funnel.everInterview, 1);
  assert.equal(stats.funnel.everOffer, 0);
});

check('a foreign default tracker ledger cannot invent selected tracker stages', 'Discarded', f => {
  writeFileSync(join(f.dataRoot, 'data', 'status-log.tsv'), '1\t2026-06-02\tApplied\tOffer\tset-status\t\n');
  const stats = cli(f, 'stats.mjs');
  assert.equal(stats.metadata.sources.statusLog, false);
  assert.equal(stats.funnel.basis, undefined);
  assert.equal(stats.funnel.everOffer, 0);
});

check('programmatic custom appsFile defaults to its sibling ledger and honors an explicit override', 'Discarded', f => {
  const ledger = join(f.trackerDir, 'status-log.tsv');
  const override = join(f.root, 'override.tsv');
  writeFileSync(ledger, '1\t2026-06-02\tApplied\tInterview\tset-status\t\n');
  writeFileSync(override, '1\t2026-06-02\tApplied\tOffer\tset-status\t\n');
  const missing = join(f.root, 'missing');
  const opts = { appsFile: f.tracker, scanHistoryFile: missing, followupsFile: missing,
    scanRunsFile: missing, portalsFile: missing, portalHealthFile: missing };
  const stats = computeAllStats(opts);
  assert.equal(stats.funnel.everInterview, 1);
  assert.equal(stats.funnel.everOffer, 0);
  assert.equal(computeAllStats({ ...opts, statusLogFile: override }).funnel.everOffer, 1);
});
