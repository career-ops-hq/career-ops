// tests/analyze-patterns-company-size.test.mjs: a comma in the team size.
//
// classifyCompanySize() read every run of digits and commas as a number. A
// comma outside a number ("~120 employees, Series B") was a run of its own,
// parsed to NaN, and Math.max over the list was NaN, which no size bound
// matches, so the company landed in "enterprise". A team size with no number
// but a comma ("Not disclosed, small team") skipped the keyword rules the same
// way.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nanalyze-patterns: a comma in the team size');

const TEAMS = [
  { team: '~120 employees, Series B', want: 'scaleup' },
  { team: '40 people, fully remote', want: 'startup' },
  { team: 'Not disclosed, small team', want: 'startup' },
  { team: '4,500 employees', want: 'enterprise' },
];

const work = mkdtempSync(join(tmpdir(), 'co-ap-size-'));
try {
  mkdirSync(join(work, 'data'), { recursive: true });
  mkdirSync(join(work, 'reports'), { recursive: true });
  const rows = [];
  TEAMS.forEach(({ team }, i) => {
    const num = i + 1;
    const file = `${String(num).padStart(3, '0')}-co${num}-2026-01-01.md`;
    writeFileSync(join(work, 'reports', file), [
      `# Evaluation: Co${num} - Data Engineer`, '',
      '## Machine Summary', '',
      '```yaml',
      `company: "Co${num}"`,
      'role: "Data Engineer"',
      'score: 3.6',
      'archetype: "AI Platform / LLMOps"',
      '```', '',
      '## A) Role Summary', '',
      '| Dimension | Detail |',
      '|---|---|',
      `| Team size | ${team} |`, '',
    ].join('\n'));
    rows.push(`| ${num} | 2026-01-01 | Co${num} | Data Engineer | 3.6/5 | Rejected | ❌ | [${num}](reports/${file}) | fixture |`);
  });
  writeFileSync(join(work, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows, '',
  ].join('\n'));

  const result = JSON.parse(execFileSync(NODE, [join(ROOT, 'analyze-patterns.mjs'), '--min-threshold', '1'], {
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CAREER_OPS_TRACKER: '', CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: work },
  }));
  const got = Object.fromEntries((result.companySizeBreakdown || []).map((p) => [p.size, p.total]));
  const want = {};
  for (const { want: size } of TEAMS) want[size] = (want[size] || 0) + 1;
  const sorted = (counts) => JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  if (sorted(got) === sorted(want)) {
    pass('a comma outside a number leaves the size to the numbers and keywords around it');
  } else {
    fail(`companySizeBreakdown -> ${sorted(got)}, expected ${sorted(want)}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
