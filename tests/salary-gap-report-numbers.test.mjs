/**
 * tests/salary-gap-report-numbers.test.mjs: a report past #999 is read.
 *
 * Report numbers are padded to three digits, so report #1000 is
 * reports/1000-*.md. salary-gap.mjs matched report files with ^(\d{3})-, so
 * from #1000 on every report was skipped and its advertised_comp never reached
 * the output.
 *
 * Run: node test-all.mjs --only salary-gap-report-numbers
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

console.log('\nsalary-gap reads reports numbered 1000 and up');

const assert = (cond, name) => (cond ? pass(name) : fail(name));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const report = (company, comp) => [
  `# Eval: ${company} - Data Engineer`,
  '',
  '## Machine Summary',
  '',
  '```yaml',
  `company: "${company}"`,
  'role: "Data Engineer"',
  `advertised_comp: "${comp}"`,
  '```',
  '',
].join('\n');

const dataRoot = mkdtempSync(join(tmpdir(), 'salary-gap-report-numbers-'));
try {
  mkdirSync(join(dataRoot, 'data'));
  mkdirSync(join(dataRoot, 'reports'));
  writeFileSync(join(dataRoot, 'reports', '999-alpha-corp-2026-11-01.md'), report('Alpha Corp', '120k USD'));
  writeFileSync(join(dataRoot, 'reports', '1000-beta-corp-2026-11-02.md'), report('Beta Corp', '130k USD'));
  writeFileSync(join(dataRoot, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 999 | 2026-11-01 | Alpha Corp | Data Engineer | 4.1/5 | Applied | ❌ | [999](../reports/999-alpha-corp-2026-11-01.md) | |',
    '| 1000 | 2026-11-02 | Beta Corp | Data Engineer | 4.2/5 | Applied | ❌ | [1000](../reports/1000-beta-corp-2026-11-02.md) | |',
    '',
  ].join('\n'));

  const run = spawnSync(process.execPath, [join(ROOT, 'salary-gap.mjs')], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
    encoding: 'utf8',
  });
  let byNum = {};
  try {
    byNum = Object.fromEntries(JSON.parse(run.stdout).applications.map((app) => [app.num, app]));
  } catch {
    fail(`salary-gap printed JSON (exit ${run.status}): ${run.stderr.slice(0, 200)}`);
  }
  assert(byNum['999']?.advertised?.value === 120000, 'report #999 gives its advertised figure');
  assert(byNum['1000']?.advertised?.value === 130000, 'report #1000 gives its advertised figure');
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}
