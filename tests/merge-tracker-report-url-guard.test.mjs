// tests/merge-tracker-report-url-guard.test.mjs — on the default nine-column
// tracker (no URL column), the posting URL in each row's linked report keeps
// two postings with fuzzy-equal titles apart.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MERGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|';
const NY = 'https://jobs.ashbyhq.com/acme/11111111-1111-4111-8111-111111111111';
const SF = 'https://jobs.ashbyhq.com/acme/22222222-2222-4222-8222-222222222222';
const TSV_HEAD = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl';

function makeEnv(rows) {
  const base = mkdtempSync(join(tmpdir(), 'merge-report-url-'));
  const env = { base, tracker: join(base, 'data', 'applications.md'), addDir: join(base, 'additions'), reportsDir: join(base, 'reports') };
  for (const dir of [dirname(env.tracker), env.addDir, env.reportsDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
  return env;
}
function writeReport(env, num, url) {
  const file = `${num}-acme-2026-10-01.md`;
  writeFileSync(join(env.reportsDir, file), `# Evaluation: Acme\n\n**Score:** 4.0/5\n**URL:** ${url}\n**PDF:** not generated\n`);
  return `[${num}](reports/${file})`;
}
function addTsv(env, id, num, role, score, report, url) {
  writeFileSync(join(env.addDir, `${id}.tsv`), `${TSV_HEAD}\n${num}\t2026-10-02\tAcme\t${role}\tEvaluated\t${score}/5\t❌\t${report}\tnote ${id}\t${url}\n`);
}
function runMerge(env) {
  const childEnv = {
    ...process.env,
    CAREER_OPS_ROOT: env.base,
    CAREER_OPS_TRACKER: env.tracker,
    CAREER_OPS_ADDITIONS: env.addDir,
    CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
  };
  delete childEnv.CAREER_OPS_DATA_DIR;
  delete childEnv.CAREER_OPS_CODE_ROOT;
  return execFileSync('node', [MERGE], { encoding: 'utf-8', env: childEnv });
}
function rows(env) {
  return readFileSync(env.tracker, 'utf-8').split('\n')
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => l.split('|').map((s) => s.trim()))
    .map((c) => ({ num: c[1], role: c[4], score: c[5], report: c[8] }));
}
const existingNy = (env) => `| 10 | 2026-10-01 | Acme | Solutions Engineer - NY | 3.5/5 | Evaluated | ❌ | ${writeReport(env, '010', NY).replace('(reports/', '(../reports/')} | first |`;

ok('a different posting with a fuzzy-equal title gets its own row', () => {
  const env = makeEnv([]);
  try {
    writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, existingNy(env), ''].join('\n'));
    addTsv(env, 1, '011', 'Solutions Engineer - SF', '4.4', writeReport(env, '011', SF), SF);
    runMerge(env);
    const got = rows(env);
    assert.deepStrictEqual(got.map((r) => r.role).sort(), ['Solutions Engineer - NY', 'Solutions Engineer - SF']);
    assert.strictEqual(got.find((r) => r.num === '10').score, '3.5/5');
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

ok('two postings merged in one run stay two rows', () => {
  const env = makeEnv([]);
  try {
    addTsv(env, 1, '011', 'Solutions Engineer - SF', '3.3', writeReport(env, '011', SF), SF);
    addTsv(env, 2, '012', 'Solutions Engineer - NY', '4.3', writeReport(env, '012', NY), NY);
    runMerge(env);
    const got = rows(env);
    assert.strictEqual(got.length, 2);
    assert.deepStrictEqual(got.map((r) => `${r.role} ${r.score}`).sort(), ['Solutions Engineer - NY 4.3/5', 'Solutions Engineer - SF 3.3/5']);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

ok('a re-evaluation of the same posting still updates its row', () => {
  const env = makeEnv([]);
  try {
    writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, existingNy(env), ''].join('\n'));
    addTsv(env, 1, '013', 'Solutions Engineer - NY', '4.1', writeReport(env, '013', NY), NY);
    runMerge(env);
    const got = rows(env);
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].score, '4.1/5');
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});
