import { pass, fail } from './helpers.mjs';
import { metricClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nMetric-claim disclosure fact gate (#3915)');

// #3915 — a sentence that CITES a job posting's numeric requirement, in order
// to disclaim a gap against it, was misread as the candidate personally
// claiming that number. cv.md never says it, so the fact gate blocked
// generation over a number that was only ever cited to be disclaimed.
//
// NEGATIVE: none of these must produce a "years"-shaped metric claim.
const disclosureCases = [
  [
    'issue example: negation lead + trailing requirement citation',
    "I want to be direct: my background is at the individual-contributor level, without the 7+ years of progressive L&D leadership this role's scope calls for.",
  ],
  [
    'negation lead + "posting requires" citation',
    "I don't want to overstate my fit -- without the 7+ years the posting requires, I'd still bring strong adjacent skills.",
  ],
  [
    '"don\'t have" negation + "position calls for" citation',
    "I don't have the 5 years this position calls for, but I have related experience.",
  ],
  [
    '"lacking" negation + "job wants" citation',
    "Honestly, I'm lacking the 10 years this job wants.",
  ],
  [
    '"doesn\'t have" negation, third person',
    "The ideal candidate doesn't have the 8 years this role requires, based on my read of the posting.",
  ],
  [
    'negation lead alone, no citation phrase in clause',
    'Without the 6 years of experience, I would still contribute immediately.',
  ],
];
for (const [label, text] of disclosureCases) {
  const claims = [...metricClaims(text)];
  const leaked = claims.filter(c => /year/.test(c));
  if (leaked.length === 0) {
    pass(`no false metric claim: ${label}`);
  } else {
    fail(`cited/disclaimed requirement was read as a personal claim (${label}): ${JSON.stringify({ text, claims: leaked })}`);
  }
}

// POSITIVE: a genuine personal claim must still be extracted and, absent
// source backing, still block. The fix must only ADD a narrow exemption for
// citation/negation language -- it must never swallow an ordinary claim just
// because "years" appears nearby.
const genuineClaimCases = [
  ['plain personal claim', 'I have 12 years of experience in this field.', '12 years'],
  ['personal claim with modifier and no negation', 'I bring 7+ years of L&D leadership to every team I join.', '7 years'],
];
for (const [label, text, expected] of genuineClaimCases) {
  const claims = [...metricClaims(text)];
  if (claims.includes(expected)) {
    pass(`genuine personal metric claim still extracted: ${label}`);
  } else {
    fail(`genuine personal metric claim was wrongly suppressed (${label}): ${JSON.stringify({ text, claims })}`);
  }
}

// End-to-end through verifyFacts: a genuinely fabricated personal metric claim
// (no source backing) must still block, and a real source-backed claim must
// still pass -- the exemption must not weaken the gate for ordinary claims.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-metric-disclosure-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(source, 'Instructional Designer with 5 years of L&D experience.');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [] }));

  const fabricated = verifyFacts('I have 12 years of experience in this field.', {
    sourcePaths: [source], configPath: config,
  });
  if (fabricated.verdict === 'block' && fabricated.invented.includes('12 years')) {
    pass('a fabricated personal metric claim with no source backing still blocks');
  } else {
    fail(`fabricated personal metric claim bypassed the fact gate: ${JSON.stringify(fabricated)}`);
  }

  const sourceBacked = verifyFacts('I bring 5 years of L&D experience to this role.', {
    sourcePaths: [source], configPath: config,
  });
  if (sourceBacked.verdict === 'pass') {
    pass('a source-backed personal metric claim still passes');
  } else {
    fail(`source-backed personal metric claim was blocked: ${JSON.stringify(sourceBacked)}`);
  }

  // The disclosure sentence itself must not block generation, since it makes
  // no claim about the candidate at all.
  const disclosure = verifyFacts(
    "I want to be direct: my background is at the individual-contributor level, without the 7+ years of progressive L&D leadership this role's scope calls for.",
    { sourcePaths: [source], configPath: config },
  );
  if (disclosure.verdict === 'pass') {
    pass('a disclosed posting-requirement citation does not block generation');
  } else {
    fail(`a disclosed posting-requirement citation was blocked: ${JSON.stringify(disclosure)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
