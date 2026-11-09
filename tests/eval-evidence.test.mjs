// A CLI evaluation must not keep a training-data salary, and missing pay or
// culture evidence must not be written as if it moved the score.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CULTURE_SCORE_FLAG,
  NO_INVENTED_PAY_RULE,
  UNKNOWN_COMP_SENTENCE,
  normalizeEvaluationText,
  postingStatesPay,
  readGlobalScore,
} from '../lib/eval-evidence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const JD_NO_PAY = 'Northwind Labs is hiring a program manager. Competitive salary. Remote.';
const JD_WITH_PAY = 'Northwind Labs is hiring a program manager. Salary: $140,000.';

function reply({ score = '4.2', decision = 'Apply', comp = 'supported', culture = 'supported', hardStops = '[]', legitimacy = 'High Confidence', extra = '' } = {}) {
  return `## D) Block D

Demand is steady.
Training-data estimate: $140,000 base.
Advertised range: $140,000, copied from the posting.
Compensation reliability: Medium. Estimated salary from similar titles.

## Cultural signals

${extra}Cultural signals: 3/5 by default, no evidence in the posting.

The compensation estimate lowers the score.

## Machine Summary

\`\`\`yaml
score: ${score}
final_decision: "${decision}"
hard_stops: ${hardStops}
legitimacy_tier: "${legitimacy}"
score_evidence:
  compensation: "${comp}"
  culture: "${culture}"
\`\`\`

**Decision:** ${decision}

## Verdict (lead)

**${decision}.** Written before the band check.

---SCORE_SUMMARY---
COMPANY: Northwind Labs
ROLE: Program Manager
SCORE: ${score}
ARCHETYPE: Program Manager
LEGITIMACY: ${legitimacy}
---END_SUMMARY---
`;
}

test('a posting states pay only when it states a figure', () => {
  assert.equal(postingStatesPay(JD_NO_PAY), false);
  assert.equal(postingStatesPay('Salary is competitive and includes equity.'), false);
  assert.equal(postingStatesPay(JD_WITH_PAY), true);
  assert.equal(postingStatesPay('Band is 90k to 110k GBP.'), true);
  assert.equal(postingStatesPay('OTE €65,000.'), true);
  assert.equal(postingStatesPay(''), false);
});

test('missing pay is marked unknown and the score number stays put', () => {
  const out = normalizeEvaluationText(reply(), JD_NO_PAY);
  assert.equal(out.includes('$140,000'), false);
  assert.equal(out.includes('Training-data'), false);
  assert.equal(out.includes('Estimated salary'), false);
  assert.match(out, /compensation: "unknown"/);
  assert.equal(out.includes(UNKNOWN_COMP_SENTENCE), true);
  assert.equal(out.includes('lowers the score'), false);
  assert.match(out, /^SCORE:\s*4\.2\s*$/m);
  assert.match(out, /^score:\s*4\.2\s*$/m);
  assert.match(out, /final_decision: "Apply"/);
  assert.match(out, /Cultural signals: unknown/);
  assert.match(out, /culture: "unknown"/);
});

test('a second pass does not duplicate the unknown-pay sentence or change the score', () => {
  const once = normalizeEvaluationText(reply(), JD_NO_PAY);
  const twice = normalizeEvaluationText(once, JD_NO_PAY);
  assert.equal(twice.split(UNKNOWN_COMP_SENTENCE).length - 1, 1);
  assert.match(twice, /^SCORE:\s*4\.2\s*$/m);
  assert.match(twice, /final_decision: "Apply"/);
});

test('a stated salary is kept, and a training-data line is still removed', () => {
  const out = normalizeEvaluationText(reply({ extra: '' }).replace(
    'Cultural signals: 3/5 by default, no evidence in the posting.',
    'Cultural signals: 4/5. The posting names a 4-day week.',
  ), `${JD_WITH_PAY}\nMarket context is not required.`);
  assert.equal(out.includes('Training-data'), false);
  assert.equal(out.includes('$140,000'), true);
  assert.match(out, /compensation: "supported"/);
  assert.equal(out.includes(UNKNOWN_COMP_SENTENCE), false);
  assert.match(out, /Cultural signals: 4\/5/);
  assert.match(out, /culture: "supported"/);
});

test('the written decision follows the band, and a hard stop or a suspicious posting overrides it', () => {
  const low = normalizeEvaluationText(reply({ score: '2.4', decision: 'Apply' }), JD_WITH_PAY);
  assert.match(low, /final_decision: "Skip"/);
  assert.match(low, /\*\*Decision:\*\* Skip/);
  assert.match(low, /^\*\*Skip\.\*\*/m);
  assert.match(low, /^SCORE:\s*2\.4\s*$/m);

  const stopped = normalizeEvaluationText(reply({
    score: '4.8',
    decision: 'Apply',
    hardStops: '\n  - "Requires a clearance the profile does not list"',
  }), JD_WITH_PAY);
  assert.match(stopped, /final_decision: "Skip"/);
  assert.match(stopped, /^SCORE:\s*4\.8\s*$/m);

  const suspicious = normalizeEvaluationText(reply({
    score: '4.6',
    decision: 'Apply',
    legitimacy: 'Suspicious',
  }), JD_WITH_PAY);
  assert.match(suspicious, /final_decision: "Research first"/);
});

test('a missing score does not become Skip', () => {
  const text = reply({ decision: 'Apply' })
    .replace(/^score:.*$/m, 'score:')
    .replace(/^SCORE:.*$/m, 'SCORE:');
  assert.equal(readGlobalScore(text), null);
  const out = normalizeEvaluationText(text, JD_WITH_PAY);
  assert.match(out, /final_decision: "Apply"/);
  assert.doesNotMatch(out, /final_decision: "Skip"/);
  assert.match(out, /\*\*Decision:\*\* Apply/);
  assert.match(out, /## Verdict \(lead\)\n\n\*\*Apply\.\*\*/);
});

test('an earlier bold Apply line stays and the verdict line follows the score', () => {
  const text = `**Apply.** Stated before the verdict.\n\n${reply({ score: '2.4', decision: 'Apply' })}`;
  const out = normalizeEvaluationText(text, JD_WITH_PAY);
  assert.match(out, /^\*\*Apply\.\*\* Stated before the verdict\./m);
  assert.match(out, /## Verdict \(lead\)\n\n\*\*Skip\.\*\*/);
  assert.match(out, /final_decision: "Skip"/);
});

test('a maybe score is Consider, not Apply', () => {
  const out = normalizeEvaluationText(reply({ score: '3.4', decision: 'Apply' }), JD_WITH_PAY);
  assert.match(out, /final_decision: "Consider"/);
  assert.match(out, /^SCORE:\s*3\.4\s*$/m);
});

test('the CLI evaluators use the shared pay rule and run the normalizer', () => {
  for (const file of ['openai-eval.mjs', 'gemini-eval.mjs', 'ollama-eval.mjs']) {
    const src = read(file);
    assert.match(src, /NO_INVENTED_PAY_RULE/, file);
    assert.match(src, /normalizeEvaluationText/, file);
    assert.match(src, /lib\/eval-evidence\.mjs/, file);
    assert.doesNotMatch(src, /training-data salary estimates/, file);
    assert.doesNotMatch(src, /salary estimates based on your training data/, file);
  }
  assert.match(NO_INVENTED_PAY_RULE, /unknown/i);
  assert.match(read('modes/_shared.md'), /does not move the global score/);
  assert.match(read('modes/oferta.md'), /Do not invent a salary/);
  assert.match(read('modes/triage.md'), /Unknown comp does\s+not move the score/);
});

test('a neutralized culture line flags that the score was not recalculated', () => {
  const once = normalizeEvaluationText(reply(), JD_WITH_PAY);
  assert.match(once, /Cultural signals: unknown/);
  assert.equal(once.split(CULTURE_SCORE_FLAG).length - 1, 1);
  assert.match(once, /^SCORE:\s*4\.2\s*$/m);
  const twice = normalizeEvaluationText(once, JD_WITH_PAY);
  assert.equal(twice.split(CULTURE_SCORE_FLAG).length - 1, 1);
});

test('an explicit deprioritize_if_absent penalty is left as written', () => {
  const penalty = 'Cultural signals: 2/5, capped because deprioritize_if_absent is set and there is no evidence in the posting.';
  const out = normalizeEvaluationText(reply().replace(
    'Cultural signals: 3/5 by default, no evidence in the posting.',
    penalty,
  ), JD_WITH_PAY);
  assert.equal(out.includes(penalty), true);
  assert.equal(out.includes('Cultural signals: unknown'), false);
  assert.equal(out.includes(CULTURE_SCORE_FLAG), false);
  assert.match(out, /culture: "supported"/);
});

test('a cap named only to say it does not apply still counts as a default', () => {
  for (const line of [
    'Cultural signals: no evidence; no cap applies, 3/5 by default.',
    'Cultural signals: 3/5 by default, no evidence in the posting; deprioritize_if_absent is not set.',
  ]) {
    const out = normalizeEvaluationText(reply().replace(
      'Cultural signals: 3/5 by default, no evidence in the posting.',
      line,
    ), JD_WITH_PAY);
    assert.equal(out.includes(line), false, line);
    assert.match(out, /Cultural signals: unknown/);
    assert.equal(out.includes(CULTURE_SCORE_FLAG), true, line);
  }
});

test('a 2/5 cap the line says is not set is still a default', () => {
  const line = 'Cultural signals: no evidence; cap at 2/5 is not set; defaults to 3.';
  const out = normalizeEvaluationText(reply().replace(
    'Cultural signals: 3/5 by default, no evidence in the posting.',
    line,
  ), JD_WITH_PAY);
  assert.equal(out.includes(line), false);
  assert.match(out, /Cultural signals: unknown/);
  assert.equal(out.includes(CULTURE_SCORE_FLAG), true);
});

test('a culture cap with no evidence is left as written', () => {
  const capped = 'Cultural signals: no evidence in the posting, capped at 2/5.';
  const out = normalizeEvaluationText(reply().replace(
    'Cultural signals: 3/5 by default, no evidence in the posting.',
    capped,
  ), JD_WITH_PAY);
  assert.equal(out.includes(capped), true);
  assert.equal(out.includes(CULTURE_SCORE_FLAG), false);
});
