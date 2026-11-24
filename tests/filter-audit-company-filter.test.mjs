// tests/filter-audit-company-filter.test.mjs — #7581: a tracked_companies entry's
// own title_filter (#7244) replaces the global one for that company, so
// filter-audit must replay that company's rows against it, not count them as
// `unmatched`. Network-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, companyTitleFilters } from '../filter-audit.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'filter-audit.mjs');
const row = (n, title, company) => ({ url: `https://x.example/${n}`, title, company });

const CFG = {
  title_filter: { positive: ['Inference'] },
  tracked_companies: [
    { name: 'Acme Robotics, Inc.', title_filter: { positive: ['Robotics', 'Inference'] } },
    { name: 'Globex' },
  ],
};
const HISTORY = [
  row(1, 'Robotics Engineer', 'Acme Robotics Inc'),
  row(2, 'Inference Engineer', 'Acme Robotics Inc'),
  row(3, 'Robotics Engineer', 'Globex'),
  row(4, 'Inference Engineer', 'Globex'),
];

test('a title only the company filter admits is not counted as unmatched', () => {
  // Only the Globex row is a real miss: Globex has no filter of its own.
  assert.equal(audit(CFG.title_filter, HISTORY, new Map(), companyTitleFilters(CFG)).unmatchedRows, 1);
});

test('company-level keywords are credited to the company, apart from the global ones', () => {
  const r = audit(CFG.title_filter, HISTORY, new Map([['https://x.example/1', 4]]), companyTitleFilters(CFG));
  const pick = (rows, keyword) => rows.find((x) => x.keyword === keyword);
  const robotics = pick(r.companyRows, 'Robotics');
  assert.deepEqual([robotics.company, robotics.hits, robotics.unique, robotics.avgScore], ['Acme Robotics, Inc.', 1, 1, 4]);
  assert.deepEqual([pick(r.companyRows, 'Inference').hits, pick(r.rows, 'Inference').hits], [1, 1]);
});

test('a company filter that matches nothing is reported, and its rows stay unmatched', () => {
  const cfg = { ...CFG, tracked_companies: [{ name: 'Acme', title_filter: { positive: ['Welding'] } }] };
  const r = audit(cfg.title_filter, [row(1, 'Inference Engineer', 'Acme')], new Map(), companyTitleFilters(cfg));
  assert.equal(r.unmatchedRows, 1);
  assert.deepEqual(r.companyRows.map((x) => [x.company, x.keyword, x.hits]), [['Acme', 'Welding', 0]]);
});

test('entries without their own usable positives keep the global filter', () => {
  const cfg = {
    title_filter: { positive: ['Inference'] },
    tracked_companies: [
      { name: 'NegativesOnly', title_filter: { negative: ['Intern'] } },
      { name: 'Blank', title_filter: { positive: ['  ', 7] } },
      { name: 'NotAnObject', title_filter: ['Robotics'] },
      null,
    ],
  };
  for (const c of [cfg, {}, undefined]) assert.equal(companyTitleFilters(c).size, 0);
  const r = audit(cfg.title_filter, [row(1, 'Inference Engineer', 'Blank')], new Map(), companyTitleFilters(cfg));
  assert.deepEqual([r.unmatchedRows, r.companyRows], [0, []]);
});

test('entries that normalize to one company name pool their keywords', () => {
  const cfg = {
    title_filter: { positive: ['Inference'] },
    tracked_companies: [
      { name: 'Acme', title_filter: { positive: ['Robotics'] } },
      { name: 'ACME Inc.', title_filter: { positive: ['robotics', 'Welding'] } },
    ],
  };
  const r = audit(cfg.title_filter, [row(1, 'Welding Engineer', 'Acme')], new Map(), companyTitleFilters(cfg));
  assert.equal(r.unmatchedRows, 0);
  assert.deepEqual(r.companyRows.map((x) => x.keyword).sort(), ['Robotics', 'Welding']);
});

test('the CLI replays a row through its company filter and prints the company section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'filter-audit-company-'));
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'portals.yml'), [
      'title_filter:', '  positive:', '    - Inference',
      'tracked_companies:', '  - name: Acme Robotics', '    title_filter:', '      positive:', '        - Robotics', '',
    ].join('\n'));
    writeFileSync(join(dir, 'data', 'scan-history.tsv'),
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://x.example/1\t2026-10-01\tgh\tRobotics Engineer\tAcme Robotics\tadded\n');
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    delete env.CAREER_OPS_PORTALS;
    delete env.CAREER_OPS_SCAN_HISTORY;
    const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf-8', timeout: 20000 });
    const json = JSON.parse(run());
    assert.equal(json.unmatchedRows, 0);
    assert.deepEqual(json.companyRows.map((x) => [x.company, x.keyword, x.hits]), [['Acme Robotics', 'Robotics', 1]]);
    const text = run('--summary');
    assert.doesNotMatch(text, /match no current keyword/);
    assert.match(text, /COMPANY-LEVEL KEYWORDS[^]*Acme Robotics\s+Robotics/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
