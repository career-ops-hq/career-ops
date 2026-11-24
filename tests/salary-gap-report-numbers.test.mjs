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

console.log('\nsalary-gap reads reports numbered 1000 and up and selects location salary bands');

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
  `advertised_comp: ${JSON.stringify(comp)}`,
  '```',
  '',
].join('\n');

const dataRoot = mkdtempSync(join(tmpdir(), 'salary-gap-report-numbers-'));
try {
  mkdirSync(join(dataRoot, 'data'));
  mkdirSync(join(dataRoot, 'reports'));
  mkdirSync(join(dataRoot, 'config'));
  writeFileSync(join(dataRoot, 'config', 'profile.yml'), [
    'candidate:',
    '  location: "New York, NY"',
    '',
  ].join('\n'));
  writeFileSync(join(dataRoot, 'reports', '1001-city-match-2026-11-03.md'), report('City Match', 'NY: $160,000 - $180,000; New York, NY: $180,000 - $205,000'));
  writeFileSync(join(dataRoot, 'reports', '1002-state-match-2026-11-04.md'), report('State Match', 'NY: $160,000 - $180,000'));
  writeFileSync(join(dataRoot, 'reports', '1003-other-tier-2026-11-05.md'), report('Other Tier', 'Springfield, IL: $150,000 - $170,000; All other locations: $140,000 - $160,000'));
  writeFileSync(join(dataRoot, 'reports', '1004-zone-no-match-2026-11-06.md'), report('Zone No Match', 'Zone 1: $150,000 - $170,000; Zone 2: $180,000 - $200,000'));
  writeFileSync(join(dataRoot, 'reports', '1005-per-level-2026-11-07.md'), report('Per Level', 'Entry-level: $90,000 - $110,000; Senior-level: $150,000 - $180,000'));
  writeFileSync(join(dataRoot, 'reports', '1006-single-range-2026-11-08.md'), report('Single Range', '$125,000 - $145,000 USD'));
  writeFileSync(join(dataRoot, 'reports', '1007-inline-labels-2026-11-09.md'), report('Inline Labels', 'Springfield, IL: $150,000 - $170,000 New York, NY: $180,000 - $205,000'));
  writeFileSync(join(dataRoot, 'reports', '999-alpha-corp-2026-11-01.md'), report('Alpha Corp', '120k USD'));
  writeFileSync(join(dataRoot, 'reports', '1000-beta-corp-2026-11-02.md'), report('Beta Corp', '130k USD'));
  writeFileSync(join(dataRoot, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 999 | 2026-11-01 | Alpha Corp | Data Engineer | 4.1/5 | Applied | ❌ | [999](../reports/999-alpha-corp-2026-11-01.md) | |',
    '| 1000 | 2026-11-02 | Beta Corp | Data Engineer | 4.2/5 | Applied | ❌ | [1000](../reports/1000-beta-corp-2026-11-02.md) | |',
    '| 1001 | 2026-11-03 | City Match | Data Engineer | 4.2/5 | Applied | ❌ | [1001](../reports/1001-city-match-2026-11-03.md) | |',
    '| 1002 | 2026-11-04 | State Match | Data Engineer | 4.2/5 | Applied | ❌ | [1002](../reports/1002-state-match-2026-11-04.md) | |',
    '| 1003 | 2026-11-05 | Other Tier | Data Engineer | 4.2/5 | Applied | ❌ | [1003](../reports/1003-other-tier-2026-11-05.md) | |',
    '| 1004 | 2026-11-06 | Zone No Match | Data Engineer | 4.2/5 | Applied | ❌ | [1004](../reports/1004-zone-no-match-2026-11-06.md) | |',
    '| 1005 | 2026-11-07 | Per Level | Data Engineer | 4.2/5 | Applied | ❌ | [1005](../reports/1005-per-level-2026-11-07.md) | |',
    '| 1006 | 2026-11-08 | Single Range | Data Engineer | 4.2/5 | Applied | ❌ | [1006](../reports/1006-single-range-2026-11-08.md) | |',
    '| 1007 | 2026-11-09 | Inline Labels | Data Engineer | 4.2/5 | Applied | ❌ | [1007](../reports/1007-inline-labels-2026-11-09.md) | |',
    '',
  ].join('\n'));

  const run = spawnSync(process.execPath, [join(ROOT, 'salary-gap.mjs')], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_PROFILE: '' },
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
  assert(byNum['1001']?.advertised?.value === 192500, 'city band takes precedence over a state band');
  assert(byNum['1001']?.advertised?.note?.includes('band: New York, NY'), 'selected city band is traceable in the observation note');
  assert(byNum['1002']?.advertised?.value === 170000, 'state band is selected when no city band matches');
  assert(byNum['1003']?.advertised?.value === 150000, 'all-other tier is selected when no city or state band matches');
  assert(byNum['1004']?.advertised === null, 'unmatched zone bands stay out of advertised gap math');
  const zoneIssue = JSON.parse(run.stdout).quality.unparseable.find((item) => item.num === '1004');
  assert(zoneIssue?.bands?.length === 2 && zoneIssue.bands[0].label === 'Zone 1', 'unmatched zone bands are listed in data quality output');
  assert(byNum['1005']?.advertised === null, 'per-level bands keep the previous unparseable behavior');
  assert(byNum['1006']?.advertised?.value === 135000, 'ordinary single-range input remains unchanged');
  assert(byNum['1007']?.advertised?.value === 192500, 'adjacent labelled bands on one line are split correctly');
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}
