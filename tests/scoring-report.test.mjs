/** Exercise scoring arithmetic and reject malformed, unsupported or inconsistent reports. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dump } from 'js-yaml';
import { calculateAttractiveness, SCORING_HEADINGS, scoreLabel, validateReport, validateReviewedReport, validateResearch } from '../scoring-report.mjs';
import { looksLikeScoreCell, parseScalarScore } from '../tracker-parse.mjs';

const weights = { direction: 0.4, compensation: 0.4, company: 0.2 };
const dimensions = Object.fromEntries(Object.keys(weights).map(key => [key, {
  score: key === 'compensation' ? null : 4,
  rationale: 'Explicit evidence or an explanation of missing information.',
  evidence: key === 'compensation' ? [] : [{ source: 'jd', quote: 'Concrete job evidence.' }],
}]));
assert.deepEqual(calculateAttractiveness(dimensions, weights), { lower: 2.8, upper: 4.4, coverage: 0.6 });
const unknown = Object.fromEntries(Object.keys(weights).map(key => [key, { score: null }]));
assert.deepEqual(calculateAttractiveness(unknown, weights), { lower: 1, upper: 5, coverage: 0 });
assert.deepEqual(calculateAttractiveness(Object.fromEntries(Object.keys(weights).map(key => [key, { score: 5 }])), weights), { lower: 5, upper: 5, coverage: 1 });
for (const score of [undefined, '4', 0, 5.5, NaN, Infinity]) {
  assert.throws(() => calculateAttractiveness({ ...dimensions, company: { score } }, weights));
}
assert.throws(() => calculateAttractiveness(dimensions, { ...weights, company: 0.5 }));
assert.throws(() => calculateAttractiveness({ ...dimensions, legitimacy: { score: 5 } }, weights));
assert.deepEqual(calculateAttractiveness({ ...dimensions, team: { score: 4 } }, { direction: 0.3, compensation: 0.3, team: 0.2, company: 0.2 }), { lower: 3.1, upper: 4.3, coverage: 0.7 });

const research = {
  searched_at: '2026-09-11', queries: ['company salary hours financial results'],
  dimensions: Object.fromEntries(['compensation', 'company'].map(key => [key, {
    queries: [0], conclusion: 'Insufficient applicable evidence.', next_step: 'Confirm employer and role terms.',
  }])),
  findings: [{ id: 'market', url: 'https://example.com/salary', entity: 'Market benchmark', scope: 'market',
    status: 'retrieved', published_at: null, limitation: 'Not an employer offer.', source: 'market', quote: 'Market range' }],
};
const researchSources = new Map([['market', 'Market range']]);
validateResearch(research, researchSources);
for (const mutate of [
  r => { delete r.dimensions.company; },
  r => { r.dimensions.company.queries = [4]; },
  r => { r.findings[0].status = 'failed'; },
  r => { r.findings[0].quote = 'Invented amount'; },
  r => { r.findings[0].scope = 'guaranteed'; },
]) {
  const value = structuredClone(research); mutate(value);
  assert.throws(() => validateResearch(value, researchSources));
}

const root = mkdtempSync(join(tmpdir(), 'scoring-report-'));
try {
  const files = {
    'research.json': JSON.stringify(research),
    'market.md': 'Market range',
    'profile.yml': dump({ attractiveness: { model: 'attractiveness-v2', weights } }),
    'jd.md': 'Concrete job evidence. Full responsibilities and qualifications are manually verified.',
    'cv.md': 'Approved candidate evidence for independent semantic review.',
    'rules.md': 'Frozen scoring contract used for this assessment.',
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  const summary = {
    report_format: 'scoring-v2', company: 'Sample', role: 'Engineer', scoring_model: 'attractiveness-v2', score: null,
    complete_jd: true, jd_source: 'jd', dimensions,
    sources: Object.entries(files).map(([path, text]) => ({
      id: path.split('.')[0], path, sha256: createHash('sha256').update(text).digest('hex'),
    })),
    attractiveness: calculateAttractiveness(dimensions, weights),
  };
  const renderWithHeadings = (value, headings) => headings.map(heading => `## ${heading}\n\n${heading === 'Machine Summary'
    ? `\`\`\`yaml\n${dump(value)}\`\`\``
    : heading === 'C. 入职吸引力'
      ? `${scoreLabel(value.attractiveness)}\n\n${Object.entries(value.dimensions).map(([key, d]) => `| ${key} | ${d.score ?? 'Unknown'} | ${weights[key] * 100}% | evidence |`).join('\n')}`
      : 'Manually reviewed content, evidence, limitations and next action.'}`).join('\n\n');
  const render = value => renderWithHeadings(value, SCORING_HEADINGS);
  const text = render(summary);
  assert.equal(validateReport(text, { root }).coverage, 0.6);
  const legacyText = renderWithHeadings(summary, ['Machine Summary', ...SCORING_HEADINGS.slice(0, -1)]);
  assert.equal(validateReport(legacyText, { root }).coverage, 0.6);
  const currentRules = structuredClone(summary);
  writeFileSync(join(root, 'rules.md'), 'research-required-v1');
  currentRules.sources = currentRules.sources.filter(s => s.id !== 'research');
  currentRules.sources.find(s => s.id === 'rules').sha256 = createHash('sha256').update('research-required-v1').digest('hex');
  assert.throws(() => validateReport(render(currentRules), { root }), /web research required/);
  writeFileSync(join(root, 'rules.md'), files['rules.md']);
  const review = {
    reviewer: 'independent-reviewer', verdict: 'approve',
    gates: Object.fromEntries(['location', 'employment', 'size', 'compensation', 'eligibility', 'liveness'].map(k => [k, 'Pass'])), ready: true,
    report_sha256: createHash('sha256').update(text).digest('hex'),
    checks: Object.fromEntries(['jd_complete', 'source_grounding', 'dimension_support', 'capability_coverage', 'no_double_count', 'gate_evidence'].map(key => [key, { status: 'pass', finding: 'Reviewed the evidence and its scope.' }])),
  };
  assert.equal(validateReviewedReport(text, review, { root }).coverage, 0.6);
  assert.throws(() => validateReviewedReport(text, { ...review, gates: undefined }, { root }), /review gates/);
  assert.throws(() => validateReviewedReport(text, { ...review, ready: undefined }, { root }), /readiness/);
  const cell = '吸引力 2.80–4.40/5（覆盖率60%）';
  assert(looksLikeScoreCell(cell));
  assert(Number.isNaN(parseScalarScore(cell)));
  assert.equal(parseScalarScore('**4.0/5**'), 4);
  assert.throws(() => validateReviewedReport(text, null, { root }), /semantic review/);
  const unsupported = structuredClone(summary);
  unsupported.dimensions.direction.evidence = [{ source: 'cv', quote: 'Approved candidate evidence' }];
  assert.throws(() => validateReviewedReport(render(unsupported), review, { root }), /stale semantic review/);
  assert.throws(() => validateReviewedReport(text, { ...review, verdict: 'revise' }, { root }), /not approved/);
  for (const mutate of [
    s => { s.attractiveness.lower = 3.2; },
    s => { s.score = 4; },
    s => { s.complete_jd = false; },
    s => { s.jd_source = 'missing'; },
    s => { s.dimensions.company.evidence = []; },
    s => { s.dimensions.company.evidence[0].quote = 'Fabricated claim'; },
    s => { s.dimensions.compensation.rationale = ''; },
    s => { s.sources[0].sha256 = '0'.repeat(64); },
    s => { s.sources.push(s.sources[0]); },
  ]) {
    const value = structuredClone(summary);
    mutate(value);
    assert.throws(() => validateReport(render(value), { root }));
  }
  assert.throws(() => validateReport(text.replace('## Risk Summary', '## Other'), { root }));
  assert.throws(() => validateReport(text.replace('2.80–4.40/5', '4.00–4.40/5'), { root }));
  assert.throws(() => validateReport(text.replace('| company | 4 |', '| company | 5 |'), { root }));
  assert.throws(() => validateReport(text.replace('## D. 薪酬与需求', '| team | 1 | conflict |\n\n## D. 薪酬与需求'), { root }));
  assert.throws(() => validateReport(text + '\n' + scoreLabel(summary.attractiveness), { root }));
  assert.throws(() => validateReport(text.replace('| company | 4 | 20%', '| company | 4 | 50%'), { root }));
  writeFileSync(join(root, 'jd.md'), readFileSync(join(root, 'jd.md'), 'utf8') + ' changed');
  assert.throws(() => validateReport(text, { root }), /hash mismatch/);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('scoring-report: arithmetic, evidence integrity and malformed-report checks passed');
