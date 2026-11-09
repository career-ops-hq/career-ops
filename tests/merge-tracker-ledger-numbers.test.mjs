import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { NODE, ROOT } from './helpers.mjs';

const TRACKER = '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|------|---------|------|-------|--------|-----|--------|-------|\n'
  + '| 1 | 2026-10-01 | Former Employer | Analyst | 4.0/5 | Evaluated | ❌ | [001](reports/001-former.md) | |\n';

function fixture(t, requested, ledger) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-ledger-number-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tracker = join(dir, 'data/applications.md');
  const additions = join(dir, 'batch/tracker-additions');
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(additions, { recursive: true });
  writeFileSync(tracker, TRACKER);
  writeFileSync(join(additions, '010-new.tsv'),
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n'
    + `${requested}\t2026-10-26\tNew Employer\tEngineer\tEvaluated\t4.0/5\t❌\t[010](reports/010-new.md)\t\n`);
  const env = {
    ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: additions,
    CAREER_OPS_BATCH_STATE: join(dir, 'batch/batch-state.tsv'),
    CAREER_OPS_FOLLOWUPS: '', CAREER_OPS_REPORTS_DIR: '', CAREER_OPS_PDF_INDEX: '',
  };
  if (ledger) {
    const path = join(dir, ledger.path);
    writeFileSync(path, ledger.contents);
    if (ledger.override) env.CAREER_OPS_FOLLOWUPS = path;
  }
  const result = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
    env, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const content = readFileSync(tracker, 'utf8');
  const row = content.split('\n').find(line => line.includes('| New Employer |'));
  assert.ok(row, `${result.stdout}\n${result.stderr}`);
  assert.ok(content.includes('| 1 | 2026-10-01 | Former Employer |'));
  if (ledger) assert.equal(readFileSync(join(dir, ledger.path), 'utf8'), ledger.contents);
  return Number(row.split('|')[1].trim());
}

const ledgers = [
  ['status history', { path: 'data/status-log.tsv', contents: '2\t2026-10-04\tEvaluated\tApplied\tset-status\t\n' }],
  ['follow-ups', { path: 'data/follow-ups.md', contents: '| 1 | 2 | 2026-10-10 | Former Employer | Analyst | Email | Pat | sent |\n' }],
  ['salary observations', { path: 'data/salary-observations.tsv', contents: '2\t2026-10-04\tdesired\t100000\tUSD\trecruiter-call\t\n' }],
  ['contacts', { path: 'data/contacts.tsv', contents: 'Pat\tFormer Employer\tRecruiter\t-\t-\t-\t-\t2\n' }],
  ['redirected follow-ups', { path: 'follow-ups-custom.md', contents: '- next #2 2026-10-30\n', override: true }],
];

for (const [label, ledger] of ledgers) {
  for (const requested of [1, 2]) {
    test(`${label}: request #${requested} cannot assign historical #2 to a new application`, t => {
      assert.equal(fixture(t, requested, ledger), 3);
    });
  }
}

test('an unoccupied reservation keeps its requested number', t => {
  assert.equal(fixture(t, 2), 2);
});
