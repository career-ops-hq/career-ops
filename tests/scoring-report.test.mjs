/** Check the current three-dimension report and its frozen evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { SCORING_HEADINGS, validateReport, validateResearch } from '../scoring-report.mjs';

const root = mkdtempSync(join(tmpdir(), 'scoring-report-'));
try {
  const research = {
    searched_at: '2026-09-30', queries: ['compensation', 'company culture'],
    dimensions: {
      compensation: { queries: [0], conclusion: 'Unknown compensation.', next_step: 'Ask recruiter.' },
      company: { queries: [1], conclusion: 'Company culture supported.', next_step: 'Confirm current policy.' },
    },
    findings: [{ id: 'f1', url: 'https://example.com/culture', entity: 'Example', scope: 'company',
      status: 'retrieved', published_at: null, limitation: 'Company level only.', source: 'web1', quote: 'Company culture evidence.' }],
  };
  const files = {
    'profile.txt': dump({ attractiveness: { model: 'attractiveness-v3' } }),
    'jd.txt': 'Concrete job evidence. Full responsibilities and qualifications are manually verified.',
    'cv.txt': 'Approved candidate evidence for independent semantic review.',
    'rules.txt': 'Current scoring contract for the assessment.',
    'research.json': JSON.stringify(research),
    'web1.txt': 'Company culture evidence.',
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  const dimensions = {
    direction: { score: 4, rationale: 'Direction supported.', evidence: [{ source: 'jd', quote: 'Concrete job evidence.' }] },
    compensation: { score: null, rationale: 'Compensation unknown.', evidence: [] },
    company: { score: 4, rationale: 'Culture supported.', evidence: [{ source: 'web1', quote: 'Company culture evidence.' }] },
  };
  const summary = {
    report_format: 'scoring-v2', scoring_model: 'attractiveness-v3', company: 'Example', role: 'Engineer',
    complete_jd: true, jd_source: 'jd', dimensions,
    sources: Object.entries(files).map(([path, content]) => ({
      id: path.split('.')[0], path, sha256: createHash('sha256').update(content).digest('hex'),
    })),
  };
  const report = value => SCORING_HEADINGS.map(heading => `## ${heading}\n\n${heading === 'Machine Summary'
    ? `\`\`\`yaml\n${dump(value)}\`\`\``
    : heading === 'C. 入职吸引力'
      ? '**入职吸引力分项：**\n\n| 维度 | 分数 |\n|---|---|\n| direction | 4 |\n| compensation | Unknown |\n| company | 4 |'
      : 'Grounded analysis with evidence, limitations, and next actions.'}`).join('\n\n');
  assert.deepEqual(validateReport(report(summary), { root }).scores,
    { direction: 4, compensation: null, company: 4 });
  validateResearch(research, new Map([['web1', files['web1.txt']]]));
  for (const text of [
    report(summary).replace('| company | 4 |', '| company | 5 |'),
    report(summary).replace('| 维度 | 分数 |', '| 维度 | 分数 | 权重 |'),
    report({ ...summary, scoring_model: 'attractiveness-v2' }),
    report({ ...summary, score: null }),
    report({ ...summary, dimensions: { ...dimensions, team: dimensions.company } }),
    report({ ...summary, sources: summary.sources.map(source => source.id === 'jd' ? { ...source, sha256: '0'.repeat(64) } : source) }),
  ]) assert.throws(() => validateReport(text, { root }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('scoring-report: current dimensions and source integrity passed');
