// tests/scan-workplace-filter-source-row.test.mjs — a posting workplace_filter
// drops is counted in the per-source table.
//
// The per-source table promises that every row adds up: fetched = source +
// title + location + age + other + seen + new (docs/SCAN_SUMMARY_TABLE.md).
// #7099 booked every filter's rejections into one of those columns, and the
// workplace filter, added three days before, was the one it missed: a dropped
// posting counted as fetched and landed in no column, so its row came up short.
//
// Runs the real scan.mjs against a local-parser fixture board with one remote
// and one on-site posting, the same way scan-employment-type-filter.test.mjs
// runs its filter end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER_PATH_VARS = [
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_ROOT',
  'CAREER_OPS_DATA_DIR',
];

function runScan(filterBlock) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-workplace-row-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'location:\n  country: Germany\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `title_filter:
  positive:
    - "Engineer"
${filterBlock}tracked_companies:
  - name: Fixture Labs
    careers_url: https://example.invalid/jobs
    parser:
      command: node
      script: tests/fixtures/workplace-filter-board.mjs
`);
    const childEnv = { ...process.env };
    for (const name of SCANNER_PATH_VARS) delete childEnv[name];
    const r = spawnSync(process.execPath, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...childEnv, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      timeout: 60_000,
    });
    const pipelinePath = join(dir, 'data', 'pipeline.md');
    const added = existsSync(pipelinePath)
      ? readFileSync(pipelinePath, 'utf-8').split('\n')
        .map(l => l.match(/^- \[[ x]\]\s+https:\/\/example\.invalid\/jobs\/([\w-]+)/)?.[1])
        .filter(Boolean)
        .sort()
      : [];
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, added };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The per-source table's Total row (no --verify, so eight numbers).
const totalRow = (stdout) => {
  const m = stdout.match(/^\s+Total((?:\s+\d+){8})\s*$/m);
  if (!m) return undefined;
  const [fetched, source, title, location, age, other, seen, added] = m[1].trim().split(/\s+/).map(Number);
  return { fetched, source, title, location, age, other, seen, added };
};

test('without workplace_filter both postings are added', () => {
  const { status, stdout, stderr, added } = runScan('');
  assert.equal(status, 0, stderr);
  assert.deepEqual(added, ['onsite-platform', 'remote-platform']);
  const total = totalRow(stdout);
  assert.ok(total, stdout);
  assert.equal(total.fetched, 2);
  assert.equal(total.added, 2);
});

test('a posting workplace_filter drops is counted under other, and the row adds up', () => {
  const { status, stdout, stderr, added } = runScan('workplace_filter:\n  allow: [remote]\n');
  assert.equal(status, 0, stderr);
  assert.deepEqual(added, ['remote-platform']);
  assert.match(stdout, /Filtered by workplace: 1 removed/);
  const total = totalRow(stdout);
  assert.ok(total, stdout);
  assert.equal(total.other, 1, `the dropped on-site posting is counted under other:\n${stdout}`);
  assert.equal(total.fetched, total.source + total.title + total.location + total.age + total.other + total.seen + total.added,
    `the per-source row adds up:\n${stdout}`);
});
