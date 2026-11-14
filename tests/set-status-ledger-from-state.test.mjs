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

function withRow(status, fn, notesCell = '') {
  const root = mkdtempSync(join(tmpdir(), 'set-status-ledger-'));
  mkdirSync(join(root, 'data'));
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 1 | 2026-10-01 | Acme | Data Engineer | 4.2/5 | ${status} | ❌ | — | ${notesCell} |`,
    '',
  ].join('\n'));
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  for (const name of OVERRIDES) env[name] = '';
  const run = (script, ...args) => spawnSync(NODE, [join(ROOT, script), ...args], { encoding: 'utf8', env, cwd: root });
  const ledger = () => readFileSync(join(root, 'data', 'status-log.tsv'), 'utf8').trim().split('\n').map((line) => line.split('\t'));
  const cells = () => readFileSync(tracker, 'utf8').split('\n').find((line) => line.startsWith('| 1 |')).split('|');
  const cell = () => cells()[6].trim();
  const notes = () => cells()[9].trim();
  try { fn({ run, ledger, cell, notes }); } finally { rmSync(root, { recursive: true, force: true }); }
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

test('text after a date moves to Notes instead of going with the old cell', () => {
  withRow('Applied 2026-10-02 via referral', ({ run, ledger, cell, notes }) => {
    const set = run('set-status.mjs', '1', 'Interview');
    assert.equal(set.status, 0, set.stderr || set.stdout);
    assert.equal(cell(), 'Interview');
    assert.equal(notes(), 'Applied 2026-10-02 via referral');
    assert.deepEqual(ledger()[0].slice(2, 4), ['Applied', 'Interview']);
  });
});

test('a --note goes in beside the moved text, and a bare date moves nothing', () => {
  withRow('Applied 2026-10-02 via referral', ({ run, notes }) => {
    const set = run('set-status.mjs', '1', 'Interview', '--note', 'call booked');
    assert.equal(set.status, 0, set.stderr || set.stdout);
    assert.match(notes(), /Applied 2026-10-02 via referral/);
    assert.match(notes(), /call booked/);
  });
  withRow('Applied 2026-10-02', ({ run, notes }) => {
    assert.equal(run('set-status.mjs', '1', 'Interview').status, 0);
    assert.equal(notes(), '');
  });
});

test('moved text is its own Notes entry, so the note beside it can still be found', () => {
  withRow('Applied 2026-10-02 via referral', ({ run, notes }) => {
    assert.equal(run('set-status.mjs', '1', 'Interview').status, 0);
    assert.equal(notes(), 'Applied 2026-10-02 via referral; call booked');
    assert.equal(run('set-status.mjs', '1', 'Interview', '--note', 'call booked').status, 0);
    assert.equal(notes(), 'Applied 2026-10-02 via referral; call booked', 'a note already there is not added again');
    const replaced = run('set-status.mjs', '1', 'Interview', '--note', 'call done', '--replace-note', 'call booked');
    assert.equal(replaced.status, 0, replaced.stderr || replaced.stdout);
    assert.equal(notes(), 'Applied 2026-10-02 via referral; call done');
  }, 'call booked');
});

test('moved text inside a longer note is still moved, so replacing that note keeps it', () => {
  withRow('Applied 2026-10-02 via referral', ({ run, notes }) => {
    assert.equal(run('set-status.mjs', '1', 'Interview').status, 0);
    assert.equal(notes(), 'Applied 2026-10-02 via referral; Reviewed Applied 2026-10-02 via referral');
    const replaced = run('set-status.mjs', '1', 'Interview', '--note', 'Recruiter replied',
      '--replace-note', 'Reviewed Applied 2026-10-02 via referral');
    assert.equal(replaced.status, 0, replaced.stderr || replaced.stdout);
    assert.equal(notes(), 'Applied 2026-10-02 via referral; Recruiter replied');
  }, 'Reviewed Applied 2026-10-02 via referral');
  withRow('Applied 2026-10-02 via referral', ({ run, notes }) => {
    assert.equal(run('set-status.mjs', '1', 'Interview').status, 0);
    assert.equal(notes(), 'call booked; Applied 2026-10-02 via referral', 'a whole entry already holding it is enough');
  }, 'call booked; Applied 2026-10-02 via referral');
});

test('a "—" in Notes is no note, and the moved text replaces it', () => {
  withRow('Applied 2026-10-02 via referral', ({ run, notes }) => {
    assert.equal(run('set-status.mjs', '1', 'Interview').status, 0);
    assert.equal(notes(), 'Applied 2026-10-02 via referral');
  }, '—');
});

