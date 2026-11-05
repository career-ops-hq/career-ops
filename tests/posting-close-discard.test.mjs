import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TODAY = '2026-11-05';
const MOVED = [1, 3, 12, 15, 16];
const KEPT = [2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 17];

function historyRow(cells) {
  const byName = Object.fromEntries(SCAN_HISTORY_COLUMNS.map((name) => [name, '']));
  Object.assign(byName, cells);
  return SCAN_HISTORY_COLUMNS.map((name) => byName[name]).join('\t');
}

function trackerRow(n, company, role, status, url, notes, report = '') {
  return `| ${n} | 2026-10-01 | ${company} | ${role} | 4/5 | ${status} | | ${report} | ${url} | ${notes} |`;
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-close-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'jds'));
  const tracker = join(dir, 'data', 'applications.md');
  const history = join(dir, 'data', 'scan-history.tsv');
  const rows = [
    trackerRow(1, 'Acme', 'Backend Engineer', 'Evaluated', 'https://jobs.example/acme-notes', 'closes 2026-10-22'),
    trackerRow(2, 'Acme', 'Applied Engineer', 'Applied', 'https://jobs.example/acme-applied', 'closes 2026-10-01'),
    trackerRow(3, 'Acme', 'Exact Engineer', 'Evaluated', 'https://jobs.example/acme-exact', ''),
    trackerRow(4, 'Acme', 'Responded Engineer', 'Responded', 'https://jobs.example/acme-responded', 'closes 2026-10-01'),
    trackerRow(5, 'Acme', 'Assessment Engineer', 'Assessment', 'https://jobs.example/acme-assessment', 'closes 2026-10-01'),
    trackerRow(6, 'Acme', 'Interview Engineer', 'Interview', 'https://jobs.example/acme-interview', 'closes 2026-10-01'),
    trackerRow(7, 'Acme', 'Offer Engineer', 'Offer', 'https://jobs.example/acme-offer', 'closes 2026-10-01'),
    trackerRow(8, 'Acme', 'Hired Engineer', 'Hired', 'https://jobs.example/acme-hired', 'closes 2026-10-01'),
    trackerRow(9, 'Acme', 'Rejected Engineer', 'Rejected', 'https://jobs.example/acme-rejected', 'closes 2026-10-01'),
    trackerRow(10, 'Acme', 'Discarded Engineer', 'Discarded', 'https://jobs.example/acme-discarded', 'closes 2026-10-01'),
    trackerRow(11, 'Acme', 'Skip Engineer', 'SKIP', 'https://jobs.example/acme-skip', 'closes 2026-10-01'),
    trackerRow(12, 'Northwind Traders', 'Analyst', 'Evaluated', 'https://jobs.example/northwind', ''),
    trackerRow(13, 'Acme', 'Today Engineer', 'Evaluated', 'https://jobs.example/acme-today', 'closes 2026-11-05'),
    trackerRow(14, 'Acme', 'Future Engineer', 'Evaluated', 'https://jobs.example/acme-future', 'closes 2026-12-01'),
    trackerRow(15, 'Acme', 'Alias Engineer', 'evaluada', 'https://jobs.example/acme-alias', 'closes 2026-08-01'),
    trackerRow(16, 'Acme', 'Unparsed Engineer', 'Evaluated', 'https://jobs.example/acme-tbd', 'deadline TBD'),
    trackerRow(17, 'Acme', 'Capture Engineer', 'Evaluated', 'https://jobs.example/acme-capture', '', '[17](reports/017-acme-backend.md)'),
  ];
  writeFileSync(tracker, [
    '# Applications',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | URL | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'jds', '017-acme-backend.md'), 'The posting closes 2026-01-01.\n');
  writeFileSync(history, [
    SCAN_HISTORY_COLUMNS.join('\t'),
    historyRow({ url: 'https://jobs.example/acme-exact', company: 'Acme', closes_at: '2026-10-03' }),
    historyRow({ url: 'https://jobs.example/acme-exact', company: 'Acme', closes_at: '' }),
    historyRow({ url: 'https://jobs.example/northwind?src=board', company: 'Northwind Traders', closes_at: '2026-09-15' }),
    historyRow({ url: 'https://jobs.example/acme-applied', company: 'Acme', closes_at: '2026-01-02' }),
    historyRow({ url: 'https://jobs.example/acme-future', company: 'Acme', closes_at: '2026-01-01' }),
    historyRow({ url: 'https://jobs.example/acme-tbd', company: 'Acme', closes_at: '2026-07-07' }),
    '',
  ].join('\n'));
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: tracker,
    CAREER_OPS_SCAN_HISTORY: history,
  };
  const run = (args) => spawnSync(process.execPath, [join(ROOT, 'closing-soon.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env,
  });
  return { dir, tracker, history, env, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function rowLine(text, n) {
  return text.split('\n').find((line) => line.startsWith(`| ${n} |`));
}

function statusOf(text, n) {
  return rowLine(text, n).split('|')[6].trim();
}

function logNums(dir) {
  const path = join(dir, 'data', 'status-log.tsv');
  let text = '';
  try { text = readFileSync(path, 'utf-8'); } catch { return []; }
  return text.split('\n').filter((line) => line && !line.startsWith('num\t')).map((line) => Number(line.split('\t')[0]));
}

test('--apply without --discard-passed does not write', () => {
  const box = sandbox();
  try {
    const before = readFileSync(box.tracker, 'utf-8');
    const result = box.run(['--apply', '--today', TODAY]);
    assert.equal(result.status, 2, describeSpawn(result));
    assert.match(result.stderr, /--discard-passed/);
    assert.equal(readFileSync(box.tracker, 'utf-8'), before);
  } finally { box.cleanup(); }
});

test('--discard-passed moves only Evaluated rows past their close date, and undo restores one', () => {
  const box = sandbox();
  try {
    const before = readFileSync(box.tracker, 'utf-8');
    const kept = Object.fromEntries(KEPT.map((n) => [n, rowLine(before, n)]));

    const report = box.run(['--today', TODAY]);
    assert.equal(report.status, 0, describeSpawn(report));
    const overdue = JSON.parse(report.stdout).overdue.map((row) => row.num);
    assert.ok(overdue.includes(17), `capture row was not visible to the report: ${report.stdout}`);
    assert.equal(readFileSync(box.tracker, 'utf-8'), before);

    const dry = box.run(['--discard-passed', '--today', TODAY]);
    assert.equal(dry.status, 0, describeSpawn(dry));
    assert.match(dry.stdout, /^Would move to Discarded: #1 #3 #12 #15 #16\n/m);
    assert.match(dry.stdout, /--discard-passed --apply/);
    assert.match(dry.stdout, /set-status\.mjs <n> --undo/);
    assert.doesNotMatch(dry.stdout, /#2\b/);
    assert.doesNotMatch(dry.stdout, /#17\b/);
    assert.equal(readFileSync(box.tracker, 'utf-8'), before);
    assert.deepEqual(logNums(box.dir), []);

    const narrowed = box.run(['--discard-passed', '--status', 'Applied', '--today', TODAY]);
    assert.equal(narrowed.status, 0, describeSpawn(narrowed));
    assert.match(narrowed.stdout, /^Would move to Discarded: #1 #3 #12 #15 #16\n/m);
    assert.equal(readFileSync(box.tracker, 'utf-8'), before);

    const applied = box.run(['--discard-passed', '--apply', '--today', TODAY]);
    assert.equal(applied.status, 0, describeSpawn(applied));
    assert.match(applied.stdout, /^Moved to Discarded: #1 #3 #12 #15 #16\n/m);
    const after = readFileSync(box.tracker, 'utf-8');
    for (const n of MOVED) assert.equal(statusOf(after, n), 'Discarded', `#${n}`);
    for (const n of KEPT) assert.equal(rowLine(after, n), kept[n], `#${n} bytes changed`);
    assert.equal(rowLine(after, 2), kept[2]);
    assert.deepEqual(logNums(box.dir), MOVED);

    const again = box.run(['--discard-passed', '--apply', '--today', TODAY]);
    assert.equal(again.status, 0, describeSpawn(again));
    assert.match(again.stdout, /No Evaluated row has a close date before 2026-11-05/);
    assert.equal(readFileSync(box.tracker, 'utf-8'), after);
    assert.deepEqual(logNums(box.dir), MOVED);

    const undo = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), '--row', '1', '--undo'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: box.env,
    });
    assert.equal(undo.status, 0, describeSpawn(undo));
    const restored = readFileSync(box.tracker, 'utf-8');
    assert.equal(statusOf(restored, 1), 'Evaluated');
    assert.equal(rowLine(restored, 2), kept[2]);
    assert.equal(statusOf(restored, 15), 'Discarded');
  } finally { box.cleanup(); }
});
