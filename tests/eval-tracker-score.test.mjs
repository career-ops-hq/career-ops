// A tracker cell can be "2.4/5" or "2.4 (weak fit)". readGlobalScore used to
// accept only a bare number, so alignDecisionToScore left the written Apply
// decision in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvaluationText, readGlobalScore } from '../lib/eval-evidence.mjs';

const JD = 'Northwind Labs is hiring a program manager. Salary: $140,000.';

function reply(score, decision) {
  return `## Machine Summary

\`\`\`yaml
score: ${score}
final_decision: "${decision}"
hard_stops: []
legitimacy_tier: "High Confidence"
score_evidence:
  compensation: "supported"
  culture: "supported"
\`\`\`

**Decision:** ${decision}

## Verdict (lead)

**${decision}.** Written before the band check.

---SCORE_SUMMARY---
COMPANY: Northwind Labs
ROLE: Program Manager
SCORE: ${score}
ARCHETYPE: Program Manager
LEGITIMACY: High Confidence
---END_SUMMARY---
`;
}

test('a score the tracker can store still sets the decision', () => {
  const source = reply('2.4/5', 'Apply');
  assert.equal(readGlobalScore(source), 2.4);
  const weak = normalizeEvaluationText(source, JD);
  assert.match(weak, /final_decision: "Skip"/);
  assert.match(weak, /\*\*Decision:\*\* Skip/);
  assert.match(weak, /^SCORE:\s*2\.4\/5\s*$/m);

  const noted = reply('2.4 (weak fit)', 'Apply');
  assert.equal(readGlobalScore(noted), 2.4);
  assert.match(normalizeEvaluationText(noted, JD), /final_decision: "Skip"/);

  assert.equal(readGlobalScore(reply('4.2/10', 'Skip')), null);
  assert.match(normalizeEvaluationText(reply('4.2/10', 'Skip'), JD), /final_decision: "Skip"/);
  assert.equal(readGlobalScore(reply('4.2 (fit 3/4 axes)', 'Skip')), null);

  const comma = reply('4,2', 'Skip');
  assert.equal(readGlobalScore(comma), 4.2);
  assert.match(normalizeEvaluationText(comma, JD), /final_decision: "Apply"/);
});

test('a blank score line does not read the next line', () => {
  const text = 'SCORE:\n2 years of Go required.\n**Score:**\n4.2 extra\nscore:\n';
  assert.equal(readGlobalScore(text), null);
});
