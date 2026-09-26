// Evidence confidence is an evaluation contract shared by interactive and
// headless modes. This suite catches missing fields or silent parser drops.
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMachineSummary } from '../analyze-patterns.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscore evidence confidence — report and parser contract');

const shared = readFileSync(join(ROOT, 'modes/_shared.md'), 'utf8');
const oferta = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf8');
const batch = readFileSync(join(ROOT, 'batch/batch-prompt.md'), 'utf8');
const check = (ok, message) => ok ? pass(message) : fail(message);

check(
  shared.includes('### Evidence confidence for the Global Score')
    && shared.includes('The Machine Summary `confidence` describes the **evidence supporting this evaluation**')
    && shared.includes('Block G\'s posting-legitimacy tier is a different judgment'),
  'canonical rubric distinguishes score evidence from legitimacy and outcomes',
);

check(
  oferta.includes('After Risk Summary, include `## Score Evidence`')
    && batch.includes('After Risk Summary in the saved report, include `## Score Evidence`')
    && batch.includes('- `## Score Evidence`'),
  'interactive and batch reports place Score Evidence after Risk Summary',
);

for (const field of ['score_evidence', 'confidence_gaps']) {
  check(
    (batch.match(new RegExp(`^${field}:`, 'gm')) ?? []).length === 2,
    `${field} appears in both batch Machine Summary examples`,
  );
}

const summary = parseMachineSummary([
  '## Machine Summary',
  '```yaml',
  'score: 4.2',
  'legitimacy_tier: High Confidence',
  'confidence: Medium',
  'score_evidence:',
  '  cv_match: supported',
  '  north_star: supported',
  '  compensation: unknown',
  '  culture: partial',
  '  red_flags: supported',
  'confidence_gaps:',
  '  - Verify guaranteed base pay',
  '```',
].join('\n'));

check(
  summary?.score === 4.2 && summary?.legitimacy_tier === 'High Confidence'
    && summary?.confidence === 'Medium'
    && summary?.score_evidence?.compensation === 'unknown'
    && summary?.score_evidence?.culture === 'partial'
    && summary?.confidence_gaps?.[0] === 'Verify guaranteed base pay',
  'downstream parser preserves distinct legitimacy, score confidence, evidence states, and verification gaps',
);

check(
  shared.includes('at least two dimensions are `unknown`')
    && shared.includes('all five dimensions are `supported`')
    && batch.includes('at least two dimensions are `unknown`')
    && batch.includes('all five are `supported`')
    && shared.includes('too incomplete to assess')
    && batch.includes('too incomplete to assess'),
  'interactive and batch rubrics keep the low-confidence cap and strict high-confidence rule',
);

// Sanitized report cases exercise the public Machine Summary contract. The
// assessment is performed by the evaluation agent, so these tests verify that
// each case's independent score, legitimacy, evidence, and checks survive the
// parser rather than pretending to execute the natural-language rubric.
const cases = [
  {
    name: 'complete evidence',
    confidence: 'High',
    legitimacy: 'High Confidence',
    evidence: ['supported', 'supported', 'supported', 'supported', 'supported'],
    gaps: [],
  },
  {
    name: 'missing salary in an otherwise usable JD',
    confidence: 'Medium',
    legitimacy: 'High Confidence',
    evidence: ['supported', 'supported', 'unknown', 'supported', 'supported'],
    gaps: ['Verify guaranteed base pay'],
  },
  {
    name: 'conflicting work-model claims',
    confidence: 'Low',
    legitimacy: 'Proceed with Caution',
    evidence: ['supported', 'supported', 'supported', 'unknown', 'supported'],
    gaps: ['Resolve remote versus office requirement'],
  },
  {
    name: 'JD too incomplete to assess',
    confidence: 'Low',
    legitimacy: 'Proceed with Caution',
    evidence: ['unknown', 'unknown', 'unknown', 'unknown', 'partial'],
    gaps: ['Obtain the full job description'],
  },
  {
    name: 'legitimate posting with low score confidence',
    confidence: 'Low',
    legitimacy: 'High Confidence',
    evidence: ['unknown', 'supported', 'supported', 'supported', 'supported'],
    gaps: ['Check the CV against the required experience'],
  },
];

const dimensionKeys = ['cv_match', 'north_star', 'compensation', 'culture', 'red_flags'];
for (const scenario of cases) {
  const parsed = parseMachineSummary([
    '## Machine Summary',
    '```yaml',
    'score: 4.2',
    `legitimacy_tier: ${scenario.legitimacy}`,
    `confidence: ${scenario.confidence}`,
    'score_evidence:',
    ...dimensionKeys.map((key, index) => `  ${key}: ${scenario.evidence[index]}`),
    ...(scenario.gaps.length
      ? ['confidence_gaps:', ...scenario.gaps.map(gap => `  - ${gap}`)]
      : ['confidence_gaps: []']),
    '```',
  ].join('\n'));

  check(
    parsed?.score === 4.2
      && parsed?.legitimacy_tier === scenario.legitimacy
      && parsed?.confidence === scenario.confidence
      && dimensionKeys.every((key, index) => parsed?.score_evidence?.[key] === scenario.evidence[index])
      && JSON.stringify(parsed?.confidence_gaps) === JSON.stringify(scenario.gaps),
    `${scenario.name}: score, legitimacy, five evidence states, tier, and gaps remain distinct`,
  );
}
