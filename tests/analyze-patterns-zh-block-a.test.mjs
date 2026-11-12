// tests/analyze-patterns-zh-block-a.test.mjs — Block A rows of a report written
// in Chinese.
//
// The Machine Summary has no remote, seniority or team-size key, so
// analyze-patterns reads those three from the Block A table. It matched the
// label cell against English and Spanish words only. A report written with
// `language.output: zh-CN` labels the rows the way modes/zh/oferta.md glosses
// them (工作模式, 资深程度, 团队规模), so every Chinese report landed in the
// "unknown" remote-policy bucket and the remote recommendation never saw it.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nanalyze-patterns — Chinese Block A labels');

const REPORTS = [
  { num: 1, company: '云栖智算', label: '工作模式', remote: '远程为主：“可远程，仅限中国大陆境内”', team: '团队规模', want: 'regional remote' },
  { num: 2, company: '流明港', label: '工作模式', remote: '每周 4 天到岗（徐汇区），不支持纯远程', team: '团队规模', want: 'hybrid/onsite' },
  { num: 3, company: '北風帳本', label: '工作模式', remote: '混合，每週 3 天進辦公室', team: '團隊規模', want: 'hybrid/onsite' },
  { num: 4, company: 'Acme', label: 'Remote', remote: 'Hybrid, 3 days/week in office', team: 'Team size', want: 'hybrid/onsite' },
  // A negated requirement is not an onsite one, and the Chinese global rule
  // runs before the English "remote" fallback.
  { num: 5, company: '远帆数据', label: '工作模式', remote: '全球远程，无需到岗', team: '团队规模', want: 'global remote' },
  { num: 6, company: '星河云', label: '工作模式', remote: '全球远程（fully remote）', team: '团队规模', want: 'global remote' },
];

const work = mkdtempSync(join(tmpdir(), 'co-ap-zh-'));
try {
  mkdirSync(join(work, 'data'), { recursive: true });
  mkdirSync(join(work, 'reports'), { recursive: true });
  const rows = [];
  for (const r of REPORTS) {
    const file = `${String(r.num).padStart(3, '0')}-co${r.num}-2026-01-01.md`;
    writeFileSync(join(work, 'reports', file), [
      `# 评估报告: ${r.company} — 高级机器学习平台工程师`, '',
      '## Machine Summary', '',
      '```yaml',
      `company: "${r.company}"`,
      'role: "高级机器学习平台工程师"',
      'score: 3.6',
      'archetype: "AI Platform / LLMOps"',
      '```', '',
      '## A) 岗位概览', '',
      '| 项目 | 内容 |',
      '|---|---|',
      `| ${r.label} | ${r.remote} |`,
      `| ${r.team} | 30 人 |`, '',
    ].join('\n'));
    rows.push(`| ${r.num} | 2026-01-01 | ${r.company} | 高级机器学习平台工程师 | 3.6/5 | Rejected | ❌ | [${r.num}](reports/${file}) | fixture |`);
  }
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
  const count = (rows, key, value) => (rows || []).find((p) => p[key] === value)?.total ?? 0;

  const wantByPolicy = {};
  for (const r of REPORTS) wantByPolicy[r.want] = (wantByPolicy[r.want] || 0) + 1;
  const policyOk = Object.entries(wantByPolicy).every(([policy, n]) => count(result.remotePolicy, 'policy', policy) === n);
  if (policyOk && count(result.remotePolicy, 'policy', 'unknown') === 0) {
    pass('Chinese 工作模式 rows are bucketed like their English equivalents, none left unknown');
  } else {
    fail(`remotePolicy → ${JSON.stringify((result.remotePolicy || []).map((p) => [p.policy, p.total]))}, expected ${JSON.stringify(wantByPolicy)}`);
  }

  if (count(result.companySizeBreakdown, 'size', 'startup') === REPORTS.length) {
    pass('Chinese 团队规模 / 團隊規模 rows feed the company-size breakdown');
  } else {
    fail(`companySizeBreakdown → ${JSON.stringify((result.companySizeBreakdown || []).map((p) => [p.size, p.total]))}, expected ${REPORTS.length} startup`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
