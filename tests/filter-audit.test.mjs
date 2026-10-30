// tests/filter-audit.test.mjs — filter-audit.mjs replays title_filter.positive
// over scan-history.tsv and ranks keywords by the offers only they catch.
//
// Network-free: audit(), readHistory() and readScoresByUrl() are pure, and the
// CLI case runs against a scratch CAREER_OPS_ROOT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, readHistory, readScoresByUrl } from '../filter-audit.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'filter-audit.mjs');
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';

const TF = { positive: ['Inference', 'Machine Learning', 'Performance', 'Quantization'] };
const HISTORY = [
  { url: 'https://x.example/1', title: 'Senior Inference Engineer', company: 'A' },
  { url: 'https://x.example/2', title: 'Machine Learning Engineer, Inference', company: 'B' },
  { url: 'https://x.example/3', title: 'High-Performance Databases Engineer', company: 'C' },
  { url: 'https://x.example/4', title: 'Performance Engineer, Storage', company: 'D' },
  { url: 'https://x.example/5', title: 'Staff Performance Engineer', company: 'E' },
  { url: 'https://x.example/6', title: 'Performance Analyst', company: 'F' },
  { url: 'https://x.example/7', title: 'Perf Engineer', company: 'G' }, // matches nothing
  { url: 'https://x.example/8', title: 'Performance Tuning Engineer', company: 'H' },
];
// Five Performance hits, all evaluated, mean exactly 1.5: on the >=5 hits /
// <2.5 average boundary the noisy rule uses.
const SCORES = new Map([
  ['https://x.example/3', 1.5], ['https://x.example/4', 1.8], ['https://x.example/5', 2.0],
  ['https://x.example/6', 1.2], ['https://x.example/8', 1.0],
]);

test('dead, redundant, unique and noisy are computed from the replay', () => {
  const r = audit(TF, HISTORY, SCORES);
  assert.ok(r.dead.includes('Quantization'), 'a keyword that matched nothing is dead');
  assert.ok(!r.dead.includes('Inference'));
  assert.equal(r.unmatchedRows, 1, 'rows matching no keyword are counted, not dropped');

  const inf = r.rows.find((x) => x.keyword === 'Inference');
  const ml = r.rows.find((x) => x.keyword === 'Machine Learning');
  assert.deepEqual([inf.hits, inf.unique], [2, 1], 'unique counts only offers this keyword alone caught');
  assert.deepEqual([ml.hits, ml.unique], [1, 0]);
  assert.ok(r.redundant.includes('Machine Learning'));

  const perf = r.rows.find((x) => x.keyword === 'Performance');
  assert.deepEqual([perf.hits, perf.avgScore], [5, 1.5], 'average over evaluated offers only');
  assert.ok(r.noisy.some((x) => x.keyword === 'Performance'));
  assert.ok(!r.noisy.some((x) => x.keyword === 'Inference'), 'an unscored keyword is not noisy');
  assert.ok(r.rows[0].unique >= r.rows.at(-1).unique, 'sorted by unique, not hits');
});

test('a duplicated keyword is audited once and does not zero its own unique', () => {
  // CodeRabbit on #2731: matchedTitleKeywords returns one hit per entry, so a
  // keyword listed twice gave every title two hits and was called redundant.
  for (const positive of [['Inference', 'Inference'], ['Inference', 'inference '], ['Inference', 'INFERENCE']]) {
    const r = audit({ positive }, [{ url: 'https://x.example/1', title: 'Inference Engineer' }], new Map());
    assert.equal(r.keywords, 1, JSON.stringify(positive));
    assert.deepEqual(r.duplicates, [positive[1]]);
    assert.equal(r.rows[0].unique, 1);
    assert.deepEqual(r.redundant, []);
  }
});

test('skipped_title rows are left out, and a posting counts once', () => {
  const tsv = [
    HEADER,
    'https://x.example/1\t2026-10-01\tgh\tInference Engineer\tA\tadded',
    'https://x.example/1/\t2026-10-02\tgh\tInference Engineer\tA\tskipped_expired',
    'https://x.example/2\t2026-10-01\tgh\tSales Director\tB\tskipped_title',
    'https://x.example/3\t2026-10-01\tgh\tInference Lead\tC\tskipped_location',
    '',
  ].join('\n');
  const rows = readHistory(tsv);
  assert.deepEqual(rows.map((r) => r.url), ['https://x.example/1', 'https://x.example/3']);
  // A rejected title would otherwise read as "the filter changed since".
  assert.equal(audit({ positive: ['Inference'] }, rows, new Map()).unmatchedRows, 0);
});

test('a posting with two reports takes the latest one, whatever the directory order', () => {
  // CodeRabbit on #2731: Map.set kept whichever report was read last.
  const old = { name: '041-acme-2026-01-07.md', text: '**URL:** https://x.example/1\n**Score:** 2.0/5\n' };
  const neu = { name: '107-acme-2026-03-02.md', text: '**URL:** <https://x.example/1/>\n**Score:** **4.2/5**\n' };
  for (const order of [[old, neu], [neu, old]]) {
    assert.equal(readScoresByUrl(order).get('https://x.example/1'), 4.2);
  }
  assert.equal(readScoresByUrl([{ name: '1-x.md', text: '**URL:** https://x.example/9\n**Score:** —\n' }]).size, 0,
    'a report without a numeric score contributes nothing');
});

test('the CLI reads the user layer under CAREER_OPS_ROOT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'filter-audit-'));
  try {
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - Inference\n    - Inference\n    - Quantization\n');
    writeFileSync(join(dir, 'data', 'scan-history.tsv'), `${HEADER}\nhttps://x.example/1\t2026-10-01\tgh\tInference Engineer\tA\tadded\n`);
    writeFileSync(join(dir, 'reports', '001-a-2026-10-02.md'), '**URL:** https://x.example/1\n**Score:** 3.5/5\n');
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    delete env.CAREER_OPS_PORTALS;
    delete env.CAREER_OPS_SCAN_HISTORY;
    const json = JSON.parse(execFileSync(process.execPath, [SCRIPT], { env, encoding: 'utf-8', timeout: 20000 }));
    assert.equal(json.offers, 1);
    assert.deepEqual(json.dead, ['Quantization']);
    assert.deepEqual(json.duplicates, ['Inference']);
    assert.equal(json.rows.find((r) => r.keyword === 'Inference').avgScore, 3.5);
    const text = execFileSync(process.execPath, [SCRIPT, '--summary'], { env, encoding: 'utf-8', timeout: 20000 });
    assert.match(text, /DUPLICATE \(1\)/);
    assert.match(text, /NEVER MATCHED \(1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pre-v1.18 three-column history still counts', () => {
  // CodeRabbit on #2731: upgrades keep the legacy url / date / title rows
  // byte-identical (test-fixtures/upgrade/state-v1.16), and read by the current
  // column order their title was empty, so the audit saw zero offers.
  const tsv = [
    'https://boards.example.test/acme/jobs/12345\t2026-06-19\tSenior Platform Engineer',
    'https://boards.example.test/globex/jobs/67890\t2026-06-24\tStaff DevOps Engineer',
    'https://boards.example.test/acme/jobs/22222\t2026-10-01\tgh\tPlatform Lead\tAcme\tadded',
    '',
  ].join('\n');
  const rows = readHistory(tsv);
  assert.deepEqual(rows.map((r) => r.title), ['Senior Platform Engineer', 'Staff DevOps Engineer', 'Platform Lead']);
  assert.deepEqual(rows.map((r) => r.company), ['', '', 'Acme']);
  assert.equal(audit({ positive: ['Platform'] }, rows, new Map()).rows[0].hits, 2);
});
