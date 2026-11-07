// tests/merge-tracker-placeholder-url-cell.test.mjs — a URL cell holding a
// placeholder names no posting, so a row's report still decides which posting
// it is. Read as a URL, the placeholder hid the report and let a different
// requisition fold into an Applied row.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MERGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|-----|';
const TSV_HEAD = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl';
const APPLIED_TO = 'https://jobs.ashbyhq.com/acme/11111111-1111-4111-8111-111111111111';
const OTHER = 'https://jobs.ashbyhq.com/acme/22222222-2222-4222-8222-222222222222';
const INDEED = 'https://www.indeed.com/viewjob?jk=0123456789abcdef';
const PLACEHOLDERS = [['an empty cell', ''], ['an em dash', '—'], ['a hyphen', '-'], ['N/A', 'N/A'], ['lower-case n/a', 'n/a']];

function setup(urlCell, reportUrl, rowsBefore = []) {
  const base = mkdtempSync(join(tmpdir(), 'merge-placeholder-url-'));
  const env = { base, tracker: join(base, 'data', 'applications.md'), addDir: join(base, 'additions'), reportsDir: join(base, 'reports') };
  for (const dir of [dirname(env.tracker), env.addDir, env.reportsDir]) mkdirSync(dir, { recursive: true });
  const report = writeReport(env, '010', reportUrl);
  const row = `| 10 | 2026-10-01 | Acme | Solutions Engineer | 3.5/5 | Applied | ❌ | ${report.replace('(reports/', '(../reports/')} | sent it | ${urlCell} |`;
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rowsBefore, row, ''].join('\n'));
  return env;
}
function writeReport(env, num, url) {
  const file = `${num}-acme-2026-10-01.md`;
  writeFileSync(join(env.reportsDir, file), `# Evaluation: Acme\n\n**Score:** 4.0/5\n**URL:** ${url}\n**PDF:** not generated\n`);
  return `[${num}](reports/${file})`;
}
function merge(env, url, role = 'Solutions Engineer') {
  const report = writeReport(env, '011', url);
  writeFileSync(join(env.addDir, '11.tsv'), `${TSV_HEAD}\n11\t2026-10-02\tAcme\t${role}\tEvaluated\t4.4/5\t❌\t${report}\tnew\t${url}\n`);
  const childEnv = {
    ...process.env,
    CAREER_OPS_ROOT: env.base,
    CAREER_OPS_TRACKER: env.tracker,
    CAREER_OPS_ADDITIONS: env.addDir,
    CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
    // Blanked so the child falls back to this fixture: merge-tracker reads the
    // PDF manifest on every run and can re-key a row in it.
    CAREER_OPS_FOLLOWUPS: '',
    CAREER_OPS_REPORTS_DIR: '',
    CAREER_OPS_PDF_INDEX: '',
  };
  delete childEnv.CAREER_OPS_DATA_DIR;
  delete childEnv.CAREER_OPS_CODE_ROOT;
  execFileSync('node', [MERGE], { encoding: 'utf-8', env: childEnv });
}
function rows(env) {
  return readFileSync(env.tracker, 'utf-8').split('\n')
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => l.split('|').map((s) => s.trim()))
    .map((c) => ({ num: c[1], score: c[5], status: c[6], notes: c[9] }));
}

// The control: this is what the guard does today, and what a placeholder must match.
for (const [label, cell] of PLACEHOLDERS) {
  ok(`${label}: another posting with the same title gets its own row`, () => {
    const env = setup(cell, APPLIED_TO);
    try {
      merge(env, OTHER);
      const got = rows(env);
      assert.strictEqual(got.length, 2, `folded into ${JSON.stringify(got)}`);
      assert.deepStrictEqual(got.find((r) => r.num === '10'), { num: '10', score: '3.5/5', status: 'Applied', notes: 'sent it' });
    } finally { rmSync(env.base, { recursive: true, force: true }); }
  });

  ok(`${label}: a re-evaluation of the same posting still updates its row`, () => {
    const env = setup(cell, APPLIED_TO);
    try {
      merge(env, APPLIED_TO);
      const got = rows(env);
      assert.strictEqual(got.length, 1, `split into ${JSON.stringify(got)}`);
      assert.strictEqual(got[0].score, '4.4/5');
      assert.strictEqual(got[0].status, 'Applied');
    } finally { rmSync(env.base, { recursive: true, force: true }); }
  });
}

// The exact URL match reads a row's posting the way the guards do. Reading the
// cell alone, it missed a row whose posting only its report names, and the
// re-evaluation fell through to the title tiers.
for (const [label, cell] of PLACEHOLDERS) {
  ok(`${label}: a re-evaluation under a new title still finds its row by the report's URL`, () => {
    const env = setup(cell, APPLIED_TO);
    try {
      merge(env, APPLIED_TO, 'Field Architect');
      const got = rows(env);
      assert.strictEqual(got.length, 1, `split into ${JSON.stringify(got)}`);
      assert.strictEqual(got[0].score, '4.4/5');
      assert.strictEqual(got[0].status, 'Applied');
    } finally { rmSync(env.base, { recursive: true, force: true }); }
  });
}

ok('the posting\'s own row is updated, not a same-title row from another board above it', () => {
  const indeedRow = `| 9 | 2026-09-30 | Acme | Solutions Engineer | 3.0/5 | Evaluated | ❌ | — | seen on Indeed | ${INDEED} |`;
  const env = setup('—', APPLIED_TO, [indeedRow]);
  try {
    merge(env, APPLIED_TO);
    const got = rows(env);
    assert.strictEqual(got.length, 2, `rows: ${JSON.stringify(got)}`);
    assert.deepStrictEqual(got.find((r) => r.num === '9'), { num: '9', score: '3.0/5', status: 'Evaluated', notes: 'seen on Indeed' });
    assert.strictEqual(got.find((r) => r.num === '10').score, '4.4/5');
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

ok('a placeholder with no posting URL in the report stays unknown, so the title decides', () => {
  const env = setup('—', 'N/A');
  try {
    merge(env, OTHER);
    assert.strictEqual(rows(env).length, 1);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

ok('a local:jds pointer in the cell is not read as a placeholder', () => {
  const env = setup('local:jds/acme-solutions.md', APPLIED_TO);
  try {
    merge(env, OTHER);
    assert.strictEqual(rows(env).length, 1, 'the pointer already names no comparable posting, and that is unchanged');
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});
