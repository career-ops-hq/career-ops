// tests/analyze-patterns-role-family.test.mjs -- interview rate by role family
// in analyze-patterns.mjs (#6028). All rows are fictional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'analyze-patterns.mjs');
const { buildRoleFamilyInterviewRate, roleFamilyOf } =
  await import(pathToFileURL(SCRIPT).href);

let nextNum = 1;
/** Build `count` tracker rows with one role title and a status list cycled. */
function rows(role, count, statusAt = () => 'applied', archetype = null) {
  return Array.from({ length: count }, (_, i) => ({
    num: nextNum++,
    role,
    normalizedStatus: statusAt(i),
    report: archetype ? { archetype } : null,
  }));
}
const family = (r, name) => r.families.find((f) => f.family === name);

test('rows group by report archetype, and archetype beats title keywords', () => {
  const all = [
    ...rows('Office Administrator', 3, () => 'applied', 'Operations Coordinator'),
    ...rows('Office Administrator', 2),
  ];
  const r = buildRoleFamilyInterviewRate(all);
  assert.equal(family(r, 'Operations Coordinator').applied, 3);
  assert.equal(family(r, 'Administrative').applied, 2);
});

test('rows without an archetype fall back to title keywords, then Unclassified', () => {
  assert.equal(roleFamilyOf({ role: 'Payroll Specialist', report: null }), 'HR / people operations');
  assert.equal(roleFamilyOf({ role: 'Instructional Designer', report: null }), 'Learning and development');
  assert.equal(roleFamilyOf({ role: 'Data Analyst', report: null }), 'Data and reporting');
  assert.equal(roleFamilyOf({ role: 'Greeter', report: null }), 'Unclassified');
  assert.equal(roleFamilyOf({ role: '', report: { archetype: '  ' } }), 'Unclassified');
});

test('a row rejected after an interview counts via the status log', () => {
  const all = rows('Instructional Designer', 4, (i) => (i === 0 ? 'rejected' : 'applied'));
  const num = all[0].num;
  const log = `${num}\t2026-03-01\tApplied\tInterview\tset-status\t\n${num}\t2026-03-09\tInterview\tRejected\tset-status\t\n`;
  const withLog = buildRoleFamilyInterviewRate(all, log);
  const without = buildRoleFamilyInterviewRate(all, '');
  assert.equal(withLog.basis, 'ledger');
  assert.equal(without.basis, 'snapshot');
  assert.equal(family(withLog, 'Learning and development').interviews, 1);
  assert.equal(family(without, 'Learning and development').interviews, 0);
});

test('unsent rows (evaluated, skip, discarded) are not applications', () => {
  const all = [
    ...rows('Data Analyst', 2, () => 'applied'),
    ...rows('Data Analyst', 1, () => 'evaluated'),
    ...rows('Data Analyst', 1, () => 'skip'),
    ...rows('Data Analyst', 1, () => 'discarded'),
  ];
  assert.equal(buildRoleFamilyInterviewRate(all).overall.applied, 2);
});

test('small-sample guard: 8 applications and 1 interview gives no suggestion', () => {
  const small = rows('Office Administrator', 8, (i) => (i === 0 ? 'interview' : 'applied'));
  const bulk = rows('Data Analyst', 40);
  const r = buildRoleFamilyInterviewRate([...small, ...bulk]);
  const f = family(r, 'Administrative');
  assert.equal(f.applied, 8);
  assert.equal(f.interviews, 1);
  assert.equal(f.sufficientSample, false);
  assert.equal(f.verdict, 'not enough data');
  assert.equal(f.ci95Pct, null);
  assert.deepEqual(r.suggestions, []);
});

test('suggestion needs both n >= 20 and a rate at least 2x overall', () => {
  // 20 applications / 2 interviews = 10%; the other 60 rows / 2 interviews = 3.3%.
  // Overall 4/80 = 5%, so 10% is exactly 2x and qualifies.
  const hot = rows('Instructional Designer', 20, (i) => (i < 2 ? 'interview' : 'applied'));
  const cold = rows('Data Analyst', 60, (i) => (i < 2 ? 'interview' : 'applied'));
  const r = buildRoleFamilyInterviewRate([...hot, ...cold]);
  assert.equal(family(r, 'Learning and development').verdict, 'suggest');
  assert.equal(family(r, 'Data and reporting').verdict, 'no clear lift');
  assert.equal(r.suggestions.length, 1);
  assert.match(r.suggestions[0], /^Learning and development: 2\/20/);
  assert.deepEqual(family(r, 'Learning and development').ci95Pct.length, 2);

  // One interview fewer: 1/20 = 5% vs overall 3/80 = 3.75%, under 2x.
  const warm = rows('Instructional Designer', 20, (i) => (i < 1 ? 'interview' : 'applied'));
  const r2 = buildRoleFamilyInterviewRate([...warm, ...cold]);
  assert.equal(family(r2, 'Learning and development').verdict, 'no clear lift');
  assert.deepEqual(r2.suggestions, []);
});

test('a large family with zero interviews and an Unclassified bucket never get suggested', () => {
  const dead = rows('Data Analyst', 30);
  const hotUnclassified = rows('Greeter', 20, (i) => (i < 10 ? 'interview' : 'applied'));
  const r = buildRoleFamilyInterviewRate([...dead, ...hotUnclassified]);
  assert.equal(family(r, 'Data and reporting').verdict, 'no clear lift');
  assert.equal(family(r, 'Unclassified').verdict, 'no clear lift');
  assert.deepEqual(r.suggestions, []);
});

test('the minimum family size is adjustable and reported', () => {
  const hot = rows('Instructional Designer', 5, (i) => (i < 2 ? 'interview' : 'applied'));
  const cold = rows('Data Analyst', 15);
  const r = buildRoleFamilyInterviewRate([...hot, ...cold], '', { minFamilyN: 5 });
  assert.equal(r.minFamilyN, 5);
  assert.equal(family(r, 'Learning and development').verdict, 'suggest');
});

test('an empty tracker yields empty families without throwing', () => {
  const r = buildRoleFamilyInterviewRate([], '');
  assert.deepEqual(r.families, []);
  assert.equal(r.overall.ratePct, null);
  assert.deepEqual(r.suggestions, []);
});

// --- CLI: JSON contract and --summary ---------------------------------------

const BASELINE_KEYS = [
  'metadata', 'funnel', 'scoreComparison', 'archetypeBreakdown', 'blockerAnalysis',
  'remotePolicy', 'companySizeBreakdown', 'vendorAnalysis', 'viaChannelAnalysis',
  'scoreThreshold', 'techStackGaps', 'discardReasonStats', 'discardReasonBase',
  'blockerBase', 'recommendations',
];

function runCli(args, trackerRows, logText = '') {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-role-family-'));
  try {
    mkdirSync(join(dataRoot, 'data'));
    writeFileSync(join(dataRoot, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      ...trackerRows, '',
    ].join('\n'), 'utf-8');
    if (logText) writeFileSync(join(dataRoot, 'data', 'status-log.tsv'), logText, 'utf-8');
    const res = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
    });
    assert.equal(res.status, 0, `${res.stderr}${res.stdout}`);
    return res.stdout;
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

const fixtureRows = [
  '| 1 | 2026-01-01 | Acme Supply | Instructional Designer | 4.0/5 | Interview | - | - | - |',
  '| 2 | 2026-01-02 | Northwind Foods | Office Administrator | 4.0/5 | Applied | - | - | - |',
  '| 3 | 2026-01-03 | Acme Supply | Data Analyst | 4.0/5 | Applied | - | - | - |',
  '| 4 | 2026-01-04 | Northwind Foods | Payroll Clerk | 4.0/5 | Rejected | - | - | - |',
  '| 5 | 2026-01-05 | Acme Supply | Greeter | 4.0/5 | Applied | - | - | - |',
];

test('JSON output keeps every existing key and adds roleFamilyInterviewRate', () => {
  const out = JSON.parse(runCli([], fixtureRows,
    '4\t2026-01-08\tApplied\tInterview\tset-status\t\n4\t2026-01-12\tInterview\tRejected\tset-status\t\n'));
  for (const key of BASELINE_KEYS) assert.ok(key in out, `missing existing key ${key}`);
  const rf = out.roleFamilyInterviewRate;
  assert.equal(rf.basis, 'ledger');
  assert.equal(rf.overall.applied, 5);
  assert.equal(rf.overall.interviews, 2);
  assert.deepEqual(rf.suggestions, []);
});

test('--summary prints n for every family and says not enough data', () => {
  const out = runCli(['--summary'], fixtureRows);
  assert.match(out, /INTERVIEW RATE BY ROLE FAMILY/);
  assert.match(out, /Learning and development\s+n=\s*1/);
  assert.match(out, /not enough data/);
  assert.doesNotMatch(out, /focus here/);
});

test('an empty tracker is still handled by the existing no-data path', () => {
  const out = JSON.parse(runCli([], []));
  assert.equal(out.noData, true);
  assert.ok(!('roleFamilyInterviewRate' in out));
});

test('an archetype that normalizes to Unclassified is never suggested', () => {
  const hot = rows('Greeter', 20, (i) => (i < 10 ? 'interview' : 'applied'), 'unclassified');
  const cold = rows('Data Analyst', 60);
  const r = buildRoleFamilyInterviewRate([...hot, ...cold]);
  const f = family(r, 'unclassified');
  assert.equal(f.sufficientSample, true);
  assert.notEqual(f.verdict, 'suggest');
  assert.deepEqual(r.suggestions, []);
});
