import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationAccessNote, EVALUATION_ACCESS_INSTRUCTION } from '../../src/lib/evaluation-access.mjs';
import { buildPrompt } from '../../src/lib/run-prompts.mjs';

for (const access of ['public', 'login_required', 'consent_required', 'email_only', 'blocked', 'unverified']) {
  test(`application access note preserves ${access} without deciding evaluation eligibility`, () => {
    assert.equal(applicationAccessNote({ access }), `application_access: ${access}`);
  });
}
for (const application of [undefined, null, {}, { httpStatus: 403 }, { access: 'unsupported' }]) {
  test(`uninspected application access stays unverified: ${JSON.stringify(application)}`, () => {
    assert.equal(applicationAccessNote(application), 'application_access: unverified');
  });
}
for (const [label, input, evaluationInstructions] of [
  ['full matching publisher JD under existing mode policy', 'https://himalayas.app/companies/fictional/jobs/manager', undefined],
  ['pasted job description', 'Fictional Company seeks a Product Manager. Full job description supplied as text.', undefined],
  ['selected evaluation', 'https://himalayas.app/companies/fictional/jobs/manager', 'Evaluate only the selected scope using the normal mode gates.'],
]) {
  test(`${label} retains the upstream liveness and confirmation boundary`, () => {
    const prompt = buildPrompt({ kind: 'evaluate', input, memory: '', today: '2026-11-04', evaluationInstructions });
    assert.ok(prompt.includes(EVALUATION_ACCESS_INSTRUCTION));
    assert.match(prompt, /application_access: login_required/);
    assert.match(prompt, /application_access: email_only/);
    assert.match(prompt, /pasted JD text: note that liveness is unverified and proceed under the mode/);
    assert.match(prompt, /readable matching publisher JD: apply the existing mode and aggregator\/employer confirmation rules/);
    assert.match(prompt, /All agency, geography, profile and LinkedIn guards still apply/);
    assert.doesNotMatch(prompt, /publisher-only JD: stop before Block A|cannot establish this exact official employer\/ATS JD|application URL returning HTTP 200|\/apply URL and require HTTP 200/);
  });
}
