// The status ledger takes a canonical state or "-" in its from column, and its
// readers drop a row with anything else. set-status copied the old cell as
// written, so a legacy `Applied 2026-01-02` row changed status, reported
// success, and left a line that --undo and the funnel could not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE, ROOT, rmSync } from './helpers.mjs';

const OVERRIDES = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV',
  'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_ACTIVITY_DIR'];

function withRow(status, fn) {
  const root = mkdtempSync(join(tmpdir(), 'set-status-ledger-'));
  mkdirSync(join(root, 'data'));
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 1 | 2026-10-01 | Acme | Data Engineer | 4.2/5 | ${status} | ❌ | — | |`,
    '',
  ].join('\n'));
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  for (const name of OVERRIDES) env[name] = '';
  const run = (script, ...args) => spawnSync(NODE, [join(ROOT, script), ...args], { encoding: 'utf8', env, cwd: root });
  const ledger = () => readFileSync(join(root, 'data', 'status-log.tsv'), 'utf8').trim().split('\n').map((line) => line.split('\t'));
  const cell = () => readFileSync(tracker, 'utf8').split('\n').find((line) => line.startsWith('| 1 |')).split('|')[6].trim();
  try { fn({ run, ledger, cell }); } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const [status, from] of [
  ['Applied', 'Applied'],
  ['Applied 2026-10-02', 'Applied'],
  ['**Applied**', 'Applied'],
  ['**Applied** 2026-10-02', 'Applied'],
  ['Aplicado', 'Applied'],
  ['Başvuruldu 2026-10-02', 'Applied'],
]) {
  test(`a "${status}" cell logs from ${from}, and the change can be undone`, () => {
    withRow(status, ({ run, ledger, cell }) => {
      const set = run('set-status.mjs', '1', 'Interview');
      assert.equal(set.status, 0, set.stderr || set.stdout);
      assert.deepEqual(ledger()[0].slice(2, 4), [from, 'Interview']);

      assert.deepEqual(JSON.parse(run('funnel-velocity.mjs').stdout).dataQuality.unparseable, []);

      const undo = run('set-status.mjs', '1', '--undo');
      assert.equal(undo.status, 0, undo.stderr || undo.stdout);
      assert.equal(cell(), 'Applied');
    });
  });
}

test('a cell outside states.yml logs "-", so the row survives its readers', () => {
  withRow('Waiting on Bob', ({ run, ledger, cell }) => {
    const set = run('set-status.mjs', '1', 'Interview');
    assert.equal(set.status, 0, set.stderr || set.stdout);
    assert.deepEqual(ledger()[0].slice(2, 4), ['-', 'Interview']);
    assert.equal(cell(), 'Interview');
    assert.deepEqual(JSON.parse(run('funnel-velocity.mjs').stdout).dataQuality.unparseable, []);
  });
});
