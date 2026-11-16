import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, describeSpawn } from './helpers.mjs';

function trackerRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-csv-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-01 | Acme, Inc. | Analytics Engineer | 4.6/5 | Applied | ✅ | [1](reports/001-acme-2026-09-01.md) | Remote; recruiter said "soon" |',
    '| 2 | 2026-09-02 | Globex | Data Analyst | 4,5/5 | Evaluated | ❌ | — | =HYPERLINK("https://jobs.example/2") |',
    '| 3 | 2026-09-03 | Initech | BI Engineer | N/A | SKIP | ❌ | — | |',
    '| 4 | 2026-09-04 | Hooli | Data Analyst | N/A (2026-09-01) | Discarded | ❌ | — | |',
    '| 5 | 2026-09-05 | Umbrella | Data Engineer | 3.9 (solid fit) | Evaluated | ❌ | reports/005-umbrella-2026-09-05.md | |',
  ].join('\n') + '\n');
  return root;
}

function query(root, args) {
  return spawnSync(process.execPath, [join(ROOT, 'tracker.mjs'), 'query', ...args], {
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_TRACKER: '', CAREER_OPS_TRACKER_DB: '' },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

test('--csv prints spreadsheet-ready rows: numeric score, yes/no PDF, report path from a link or a plain cell', (t) => {
  const result = query(trackerRoot(t), ['--csv']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.equal(result.stdout, [
    'id,date,company,role,score,status,pdf,report,notes',
    '5,2026-09-05,Umbrella,Data Engineer,3.9,Evaluated,no,reports/005-umbrella-2026-09-05.md,',
    '4,2026-09-04,Hooli,Data Analyst,,Discarded,no,,',
    '3,2026-09-03,Initech,BI Engineer,,SKIP,no,,',
    `2,2026-09-02,Globex,Data Analyst,4.5,Evaluated,no,,"'=HYPERLINK(""https://jobs.example/2"")"`,
    '1,2026-09-01,"Acme, Inc.",Analytics Engineer,4.6,Applied,yes,reports/001-acme-2026-09-01.md,"Remote; recruiter said ""soon"""',
    '',
  ].join('\n'));
});

test('--csv keeps the query filters', (t) => {
  const result = query(trackerRoot(t), ['--status', 'Evaluated', '--min-score', '4', '--csv']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.deepEqual(result.stdout.trim().split('\n').map((line) => line.split(',')[0]), ['id', '2']);
});

test('--csv with no matching rows prints only the header', (t) => {
  const result = query(trackerRoot(t), ['--company', 'Vandelay', '--csv']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.equal(result.stdout, 'id,date,company,role,score,status,pdf,report,notes\n');
});

test('--csv and --json together are a usage error', (t) => {
  const result = query(trackerRoot(t), ['--csv', '--json']);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stderr, /--csv and --json/);
  assert.equal(result.stdout, '');
});
