import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MERGE = join(ROOT, 'merge-tracker.mjs');

function fixture(hasLocationColumn) {
  const root = mkdtempSync(join(tmpdir(), 'merge-location-report-'));
  const tracker = join(root, 'data', 'applications.md');
  const additions = join(root, 'batch', 'tracker-additions');
  mkdirSync(dirname(tracker), { recursive: true });
  mkdirSync(additions, { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  const locationHeader = hasLocationColumn ? ' | Location' : '';
  const locationSeparator = hasLocationColumn ? ' | ---' : '';
  writeFileSync(tracker, [
    '# Applications Tracker',
    '',
    `| # | Date | Company | Role | Score | Status | PDF | Report | Notes${locationHeader} |`,
    `|---|---|---|---|---|---|---|---|---${locationSeparator}|`,
    '',
  ].join('\n'));
  writeFileSync(join(root, 'reports', '001-acme.md'), [
    '# Evaluation: Acme',
    '',
    '## Job Description (archived verbatim)',
    '',
    'Based in Austin, TX.',
    '',
    '## Machine Summary',
    '',
    '```yaml',
    'posting_location: "Austin, TX"',
    '```',
    '',
  ].join('\n'));
  writeFileSync(join(additions, '001-acme.tsv'), [
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes',
    '1\t2026-11-19\tAcme\tEngineer\tEvaluated\t4.0/5\t❌\t[1](reports/001-acme.md)\ttest',
    '',
  ].join('\n'));
  return { root, tracker, additions };
}

function runMerge(env) {
  const result = spawnSync(process.execPath, [MERGE], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: env.root,
      CAREER_OPS_TRACKER: env.tracker,
      CAREER_OPS_ADDITIONS: env.additions,
      CAREER_OPS_BATCH_STATE: join(env.root, 'batch', 'batch-state.tsv'),
      CAREER_OPS_FOLLOWUPS: '',
      CAREER_OPS_REPORTS_DIR: '',
      CAREER_OPS_PDF_INDEX: '',
    },
  });
  assert.equal(result.error, undefined, `merge-tracker failed to spawn: ${result.error?.message}`);
  assert.equal(result.status, 0, describeSpawn(result));
  return readFileSync(env.tracker, 'utf-8').split('\n').find(line => /^\|\s*1\s*\|/.test(line));
}

test('linked report posting_location fills a tracker Location column when the addition omits location', () => {
  const env = fixture(true);
  try {
    const row = runMerge(env);
    assert.match(row, /\| Austin, TX \|$/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test('linked report posting_location is kept in Notes when the tracker has no Location column', () => {
  const env = fixture(false);
  try {
    const row = runMerge(env);
    assert.match(row, /\| test(?:\s+|\. )Location: Austin, TX/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});
