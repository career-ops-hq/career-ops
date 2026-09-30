#!/usr/bin/env node
/** Recompute and validate evidence-backed attractiveness reports before publication. */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { load } from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODEL_DIMENSIONS = {
  'attractiveness-v1': ['direction', 'compensation', 'team', 'company'],
  'attractiveness-v2': ['direction', 'compensation', 'company'],
};
export const GATES = ['location', 'employment', 'size', 'compensation', 'eligibility', 'liveness'];
export const HEADINGS = [
  'Machine Summary', 'A. 岗位概览', 'B. 能力竞争力', 'C. 入职吸引力',
  'D. 薪酬与需求', 'E. CV 变更计划', 'F. 面试与补证', 'G. 岗位真实性',
  'Risk Summary', 'Evaluation Checklist',
];
export const SCORING_HEADINGS = [
  'A. 岗位概览', 'B. 能力竞争力', 'C. 入职吸引力', 'D. 薪酬与需求',
  'E. 补证问题', 'G. 岗位真实性', 'Risk Summary', 'Evaluation Checklist', 'Machine Summary',
];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label}: unexpected or missing keys`);
}

/** Unknown dimensions contribute their full [1, 5] range and no evidence coverage. */
export function calculateAttractiveness(dimensions, weights) {
  const names = Object.values(MODEL_DIMENSIONS).find(keys => Object.keys(weights).sort().join(',') === [...keys].sort().join(','));
  requireValue(names, 'weights: unexpected or missing keys');
  exactKeys(dimensions, names, 'dimensions');
  requireValue(Object.values(weights).every(w => Number.isFinite(w) && w > 0)
    && Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'weights must be positive and sum to 1');
  let lower = 0, upper = 0, coverage = 0;
  for (const key of names) {
    const score = dimensions[key]?.score;
    requireValue(score === null || (Number.isInteger(score) && score >= 1 && score <= 5), `${key}: score must be null or an integer from 1 to 5`);
    lower += weights[key] * (score ?? 1);
    upper += weights[key] * (score ?? 5);
    if (score !== null) coverage += weights[key];
  }
  return { lower: Number(lower.toFixed(2)), upper: Number(upper.toFixed(2)), coverage: Number(coverage.toFixed(6)) };
}

export function scoreLabel({ lower, upper, coverage }) {
  return `**入职吸引力：** ${lower.toFixed(2)}–${upper.toFixed(2)}/5；证据覆盖率：${Number((coverage * 100).toFixed(4))}%`;
}

/** Validate the research audit trail; scope and sufficiency still require semantic review. */
export function validateResearch(research, sources, dimensions = MODEL_DIMENSIONS['attractiveness-v2']) {
  requireValue(research && /^\d{4}-\d{2}-\d{2}$/.test(research.searched_at), 'research date required');
  requireValue(Array.isArray(research.queries) && research.queries.length > 0 && research.queries.length <= 5
    && research.queries.every(q => typeof q === 'string' && q.trim()), 'research requires 1–5 executed queries');
  exactKeys(research.dimensions, dimensions.slice(1), 'research dimensions');
  for (const [key, dimension] of Object.entries(research.dimensions)) {
    requireValue(Array.isArray(dimension.queries) && dimension.queries.length > 0
      && dimension.queries.every(i => Number.isInteger(i) && i >= 0 && i < research.queries.length), `${key}: executed query reference required`);
    requireValue(typeof dimension.conclusion === 'string' && dimension.conclusion.trim()
      && typeof dimension.next_step === 'string' && dimension.next_step.trim(), `${key}: research conclusion and next step required`);
  }
  requireValue(Array.isArray(research.findings), 'research findings required');
  const ids = new Set();
  for (const finding of research.findings) {
    requireValue(typeof finding.id === 'string' && finding.id.trim() && !ids.has(finding.id), 'research finding IDs must be unique');
    ids.add(finding.id);
    requireValue(['retrieved', 'search_only', 'failed', 'excluded'].includes(finding.status), 'research access status required');
    requireValue(['role', 'team', 'company', 'adjacent_role', 'market', 'unresolved'].includes(finding.scope), 'research scope required');
    requireValue(typeof finding.url === 'string' && /^https?:\/\//.test(finding.url)
      && typeof finding.entity === 'string' && finding.entity.trim()
      && typeof finding.limitation === 'string' && finding.limitation.trim(), 'research URL, entity and limitations required');
    requireValue(finding.published_at === null || (typeof finding.published_at === 'string' && finding.published_at.trim()), 'research publication date or null required');
    if (finding.status === 'retrieved') {
      requireValue(typeof finding.quote === 'string' && finding.quote.trim()
        && sources.get(finding.source)?.includes(finding.quote), 'research quote missing from frozen source');
    } else requireValue(finding.source === null && finding.quote === null, 'unretrieved research cannot provide scored evidence');
  }
}

function sectionBodies(text) {
  const headings = [...text.matchAll(/^## (.+)$/gm)];
  return new Map(headings.map((heading, index) => [
    heading[1],
    text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim(),
  ]));
}

/** Validate structure, frozen sources, literal citations and arithmetic; semantic review remains required. */
export function validateReport(text, { root = ROOT } = {}) {
  const fence = text.match(/## Machine Summary\s*\n+```(?:yaml|yml)\s*\n([\s\S]*?)\n```/);
  requireValue(fence, 'missing Machine Summary YAML');
  const summary = load(fence[1]);
  requireValue(summary?.report_format === undefined || summary.report_format === 'scoring-v2', 'unknown report format');
  const headings = [...text.matchAll(/^## (.+)$/gm)];
  const expected = summary.report_format === 'scoring-v2' ? SCORING_HEADINGS : HEADINGS;
  const actualHeadings = headings.map(m => m[1]);
  const legacyExpected = summary.report_format === 'scoring-v2'
    ? ['Machine Summary', ...SCORING_HEADINGS.slice(0, -1)]
    : expected;
  requireValue([expected, legacyExpected].some(order => actualHeadings.join('|') === order.join('|')), 'report headings must match the scoring contract in order');
  const bodies = sectionBodies(text);
  for (const [name, body] of bodies) {
    requireValue(body.length >= 20, `empty section: ${name}`);
  }
  const dimensions = MODEL_DIMENSIONS[summary?.scoring_model];
  requireValue(dimensions, 'unknown attractiveness model');
  requireValue(summary.score === null, 'attractiveness must not publish a scalar score');
  requireValue(summary.complete_jd === true, 'complete JD required; record incomplete without a scored report');
  requireValue(typeof summary.company === 'string' && summary.company.trim()
    && typeof summary.role === 'string' && summary.role.trim(), 'company and role required');
  requireValue(Array.isArray(summary.sources) && summary.sources.length > 0, 'sources required');
  const sources = new Map();
  const base = realpathSync(root);
  for (const source of summary.sources) {
    requireValue(typeof source.id === 'string' && source.id.trim() && !sources.has(source.id), 'source IDs must be unique');
    requireValue(typeof source.path === 'string' && !isAbsolute(source.path), 'source path must be repository-relative');
    const path = realpathSync(resolve(base, source.path));
    const rel = relative(base, path);
    requireValue(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel), 'source escapes repository');
    const bytes = readFileSync(path);
    requireValue(createHash('sha256').update(bytes).digest('hex') === source.sha256, `source hash mismatch: ${source.id}`);
    sources.set(source.id, bytes.toString('utf8'));
  }
  requireValue(typeof summary.jd_source === 'string' && sources.has(summary.jd_source), 'jd_source must reference frozen JD');
  requireValue(sources.has('profile'), 'frozen profile required');
  requireValue(sources.has('cv') && sources.has('rules'), 'frozen candidate CV and scoring rules required');
  requireValue(sources.has('research'), 'frozen web research required by scoring rules');
  validateResearch(JSON.parse(sources.get('research')), sources, dimensions);
  const profile = load(sources.get('profile'));
  requireValue(profile?.attractiveness?.model === summary.scoring_model, 'profile model mismatch');
  const result = calculateAttractiveness(summary.dimensions, profile.attractiveness.weights);
  for (const key of dimensions) {
    const dimension = summary.dimensions[key];
    exactKeys(dimension, ['score', 'rationale', 'evidence'], key);
    requireValue(typeof dimension.rationale === 'string' && dimension.rationale.trim().length > 0, `${key}: rationale required`);
    requireValue(Array.isArray(dimension.evidence), `${key}: evidence must be an array`);
    requireValue(dimension.score === null || dimension.evidence.length > 0, `${key}: known score requires evidence`);
    for (const citation of dimension.evidence) {
      requireValue(typeof citation?.quote === 'string' && citation.quote.trim().length > 0
        && sources.get(citation.source)?.includes(citation.quote), `${key}: quote not found in cited frozen source`);
    }
  }
  exactKeys(summary.attractiveness, ['lower', 'upper', 'coverage'], 'attractiveness');
  for (const key of Object.keys(result)) {
    requireValue(summary.attractiveness[key] === result[key], `${key}: expected ${result[key]}`);
  }
  const labels = text.split('\n').filter(line => line.includes('入职吸引力：'));
  requireValue(labels.length === 1 && labels[0] === scoreLabel(result), 'body must contain exactly one matching score/range');
  const scoreSection = bodies.get('C. 入职吸引力');
  const rows = scoreSection.split('\n').filter(line => /^\s*\|/.test(line))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
  requireValue(rows.every(cells => dimensions.includes(cells[0]) || cells[0] === '维度' || /^[-: ]+$/.test(cells[0])), 'unexpected score table row');
  for (const key of dimensions) {
    const matching = rows.filter(cells => cells[0] === key);
    const weight = `${Number((profile.attractiveness.weights[key] * 100).toFixed(6))}%`;
    requireValue(matching.length === 1 && matching[0][1] === String(summary.dimensions[key].score ?? 'Unknown')
      && matching[0][2] === weight, `${key}: missing, duplicate or inconsistent score/weight row`);
  }
  return { company: summary.company, role: summary.role, scoring_model: summary.scoring_model,
    weights: profile.attractiveness.weights, ...result };
}

/** Bind a separate semantic review to the exact report; a literal quote alone is not approval. */
export function validateReviewedReport(text, review, options) {
  const result = validateReport(text, options);
  requireValue(review?.report_sha256 === createHash('sha256').update(text).digest('hex'), 'missing or stale semantic review');
  requireValue(typeof review.reviewer === 'string' && review.reviewer.trim(), 'reviewer required');
  requireValue(review.verdict === 'approve', 'semantic review has not approved this report');
  exactKeys(review.gates, GATES, 'review gates');
  requireValue(Object.values(review.gates).every(value => ['Pass', 'Fail', 'Unknown'].includes(value))
    && typeof review.ready === 'boolean', 'review gate states and readiness required');
  const checks = ['jd_complete', 'source_grounding', 'dimension_support', 'capability_coverage', 'no_double_count', 'gate_evidence'];
  exactKeys(review.checks, checks, 'semantic checks');
  for (const key of checks) {
    requireValue(review.checks[key]?.status === 'pass' && typeof review.checks[key].finding === 'string'
      && review.checks[key].finding.trim(), `${key}: semantic review must pass with a finding`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('Usage: node scoring-report.mjs <report.md>... (loads <report>.review.json)');
    process.exitCode = 1;
  }
  for (const path of paths) {
    try {
      const text = readFileSync(path, 'utf8');
      validateReport(text);
      const review = JSON.parse(readFileSync(`${path}.review.json`, 'utf8'));
      console.log(JSON.stringify({ path, valid: true, ...validateReviewedReport(text, review) }));
    } catch (error) {
      console.log(JSON.stringify({ path, valid: false, error: error.message }));
      process.exitCode = 1;
    }
  }
}
