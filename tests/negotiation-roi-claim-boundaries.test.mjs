import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaim, analyze } from '../negotiation-roi.mjs';

test('verifyClaim rejects h/hr/hour unit prefixes inside unrelated words', () => {
  const claim = { type: 'time-reduction', before: { value: 8 }, after: { value: 2 } };
  for (const cv of [
    'Built 8 high-availability services and 2 headless pipelines at Acme.',
    'Managed 8 hospitals across 2 hubs.',
    'Configured 8hz and 2hz telemetry sensors.',
    'Supported 8 hris integrations and 2 hourly feeds.',
    'Migrated v8h clusters to v2h nodes.',
  ]) {
    assert.equal(verifyClaim(claim, cv).verified, false, `should not verify against: ${cv}`);
  }
});

test('verifyClaim rejects partial numbers preceded by comma grouping or decimals', () => {
  assert.equal(
    verifyClaim(
      { type: 'time-reduction', before: { value: 200 }, after: { value: 100 } },
      'Cut annual compute from 1,200 hours to 1,100 hours.',
    ).verified,
    false,
  );
  assert.equal(
    verifyClaim(
      { type: 'time-reduction', before: { value: 8 }, after: { value: 5 } },
      'Cut runtime from 8 hours to 2.5 hours.',
    ).verified,
    false,
  );
  assert.equal(
    verifyClaim(
      { type: 'percent-reduction', percent: 60 },
      'Improved throughput by 160% and reduced error rate by 0.60%.',
    ).verified,
    false,
  );
});

test('verifyClaim accepts genuine sentence-ending percent and hour claims followed by a period', () => {
  assert.equal(
    verifyClaim(
      { type: 'percent-reduction', percent: 60 },
      '- Reduced review turnaround by 60%.',
    ).verified,
    true,
  );
  assert.equal(
    verifyClaim(
      { type: 'time-reduction', before: { value: 8 }, after: { value: 2 } },
      '- Cut deployment time from 8h to 2h.',
    ).verified,
    true,
  );
  assert.equal(
    verifyClaim(
      { type: 'time-reduction', before: { value: 8 }, after: { value: 2 } },
      '- Cut deployment time from 8 hr to 2 hr.',
    ).verified,
    true,
  );
  assert.equal(
    verifyClaim(
      { type: 'time-reduction', before: { value: 20 }, after: { value: 5 } },
      '- Cut a recurring audit process from 20 hours to 5 hours.',
    ).verified,
    true,
  );
});

test('analyze enforces the safety gate end-to-end on h-word prose and sentence-ending CV bullets', () => {
  const storyBank = `
### [Fabricated] Unbacked time reduction

**Source:** Acme Corp, 2025

**S (Situation):** Releases were slow.

**T (Task):** Speed them up.

**A (Action):** Cut release time from 8 hours to 2 hours, done weekly at $50/hr.

**R (Result):** Faster deploys.

**Reflection:** N/A

### [Verified] Sentence-ending compact units

**Source:** Acme Corp, 2025

**S (Situation):** Builds were slow.

**T (Task):** Optimize CI.

**A (Action):** Cut build time from 6 hours to 1 hour, done weekly at $50/hr, and reduced failures by 40%.

**R (Result):** Faster CI.

**Reflection:** N/A
`;
  const cv = `
# Jordan Example

## Experience

- Built 8 high-availability services and 2 headless pipelines at Acme.
- Cut CI build time from 6h to 1h.
- Reduced build failures by 40%.
`;

  const result = analyze(storyBank, cv, {});
  assert.equal(result.excludedUnverified, 1);
  assert.equal(result.calculable.length, 1);
  assert.ok(result.calculable[0].story.includes('Sentence-ending compact units'));
  assert.equal(result.uncalculable.length, 1);
  assert.equal(result.uncalculable[0].claimType, 'percent-reduction');
});
