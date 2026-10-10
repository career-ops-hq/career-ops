// tests/jev-machine-summary.test.mjs — deterministic Machine Summary composer
// (lib/jev-machine-summary.mjs): Jev→contract mappings, contract validation,
// and the YAML render/extract round trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MACHINE_SUMMARY_VERSION,
  LEGITIMACY_TIERS,
  RISK_LEVELS,
  CONFIDENCE_LEVELS,
  FINAL_DECISIONS,
  WORK_AUTH_OPTIONS,
  EVIDENCE_VALUES,
  IMPORTANCE_VALUES,
  MATCH_VALUES,
  RISK_SUMMARY_ENUMS,
  MACHINE_SUMMARY_FIELDS,
  jevTierToMachineTier,
  jevRiskToMachineRisk,
  machineSummaryForJev,
  riskSummaryLegitimacyFromJev,
  validateMachineSummary,
  isValidMachineSummary,
  renderMachineSummaryYaml,
  extractMachineSummary,
} from '../lib/jev-machine-summary.mjs';
import { load as yamlLoad } from 'js-yaml';

const validSummary = {
  company: 'Acme Corp',
  role: 'Staff AI Engineer',
  score: 4.2,
  legitimacy_tier: 'High Confidence',
  archetype: 'agentic_automation',
  final_decision: 'Apply',
  hard_stops: [],
  soft_gaps: ['Presence requirement unverified'],
  top_strengths: ['Hands-on agent orchestration at scale'],
  risk_level: 'Medium',
  confidence: 'High',
  next_action: 'Confirm salary range with recruiter',
  work_auth: 'unstated',
  discard_reasons: [],
  via: null,
  company_confidential: false,
  advertised_comp: '80-90k EUR',
  reports_to: 'VP of Engineering',
  requirement_importance: [
    { requirement: 'Experience with LLM evals', jd_signal: 'proficient in building evaluation suites', evidence: 'stated', importance: 'high', match: 'strong' },
    { requirement: 'Knowledge of Kubernetes', jd_signal: null, evidence: 'structural', importance: 'meaningful', match: 'partial' },
  ],
  risk_summary: {
    legitimacy: 'high_confidence',
    classification: 'clear',
    culture: 'pass',
    interview_redflags: 'none',
    ai_infra: 'consistent',
    ai_screening_disclosure: 'no_match',
  },
};

test('MACHINE_SUMMARY_VERSION is a semantic version string', () => {
  assert.match(MACHINE_SUMMARY_VERSION, /^\d+\.\d+\.\d+$/);
});

test('contract vocab exports carry the expected enum sets', () => {
  assert.deepEqual(LEGITIMACY_TIERS, ['High Confidence', 'Proceed with Caution', 'Suspicious']);
  assert.deepEqual(RISK_LEVELS, ['Low', 'Medium', 'High']);
  assert.deepEqual(CONFIDENCE_LEVELS, ['Low', 'Medium', 'High']);
  assert.deepEqual(FINAL_DECISIONS, ['Apply', 'Consider', 'Research first', 'Skip']);
  assert.deepEqual(WORK_AUTH_OPTIONS, ['sponsors', 'not_needed', 'unstated', 'no_sponsorship']);
  assert.deepEqual(EVIDENCE_VALUES, ['stated', 'structural', 'inferred']);
  assert.deepEqual(IMPORTANCE_VALUES, ['critical', 'high', 'meaningful', 'preferred', 'low_signal']);
  assert.deepEqual(MATCH_VALUES, ['strong', 'partial', 'missing', 'na']);
  assert.deepEqual(Object.keys(RISK_SUMMARY_ENUMS).sort(), [
    'ai_infra', 'ai_screening_disclosure', 'classification', 'culture', 'interview_redflags', 'legitimacy',
  ].sort());
  assert.ok(MACHINE_SUMMARY_FIELDS.includes('legitimacy_tier'));
  assert.ok(MACHINE_SUMMARY_FIELDS.includes('risk_summary'));
});

test('jevTierToMachineTier maps the snake keys to the top-level wording', () => {
  assert.equal(jevTierToMachineTier('high_confidence'), 'High Confidence');
  assert.equal(jevTierToMachineTier('proceed_with_caution'), 'Proceed with Caution');
  assert.equal(jevTierToMachineTier('suspicious'), 'Suspicious');
  assert.equal(jevTierToMachineTier('not_a_key'), null);
});

test('jevRiskToMachineRisk maps the snake keys to the top-level wording', () => {
  assert.equal(jevRiskToMachineRisk('low'), 'Low');
  assert.equal(jevRiskToMachineRisk('medium'), 'Medium');
  assert.equal(jevRiskToMachineRisk('high'), 'High');
  assert.equal(jevRiskToMachineRisk('severe'), null);
});

test('machineSummaryForJev composes only the four mapped decisions', () => {
  const decisions = {
    legitimacy_tier: { machineField: 'legitimacy_tier', value: 'suspicious' },
    risk_level: { machineField: 'risk_level', value: 'medium' },
    work_authorization: { machineField: 'work_auth', value: 'unstated' },
    archetype: { machineField: 'archetype', value: 'agentic_automation' },
    unknown_extra: { value: 'ignored' },
  };
  assert.deepEqual(machineSummaryForJev(decisions), {
    legitimacy_tier: 'Suspicious',
    risk_level: 'Medium',
    work_auth: 'unstated',
    archetype: 'agentic_automation',
  });
});

test('machineSummaryForJev skips unanswered, errored, and unmappable decisions', () => {
  const decisions = {
    legitimacy_tier: { machineField: 'legitimacy_tier', value: 'weird' },
    risk_level: { machineField: 'risk_level', value: null, error: 'missing answer' },
    archetype: { machineField: 'archetype', value: 'other' },
  };
  assert.deepEqual(machineSummaryForJev(decisions), { archetype: 'other' });
  assert.deepEqual(machineSummaryForJev(null), {});
  assert.deepEqual(machineSummaryForJev({}), {});
});

test('riskSummaryLegitimacyFromJev returns the snake key for risk_summary.legitimacy', () => {
  assert.equal(
    riskSummaryLegitimacyFromJev({ legitimacy_tier: { machineField: 'legitimacy_tier', value: 'proceed_with_caution' } }),
    'proceed_with_caution',
  );
  assert.equal(riskSummaryLegitimacyFromJev({}), null);
});

test('a fully populated summary validates clean', () => {
  assert.deepEqual(validateMachineSummary(validSummary), []);
  assert.equal(isValidMachineSummary(validSummary), true);
});

test('validateMachineSummary rejects non-objects and broken scalar contracts', () => {
  assert.notEqual(validateMachineSummary(null).length, 0);
  assert.notEqual(validateMachineSummary([1, 2]).length, 0);
  assert.notEqual(validateMachineSummary('x').length, 0);

  const bad = { ...validSummary, company: '', role: 42, score: '4.2/5' };
  const problems = validateMachineSummary(bad);
  assert.match(problems.join('\n'), /company: must be a non-empty string/);
  assert.match(problems.join('\n'), /role: must be a non-empty string/);
  assert.match(problems.join('\n'), /score: must be a finite number/);
});

test('validateMachineSummary rejects enum drift on the Jev fields', () => {
  const cases = [
    { ...validSummary, legitimacy_tier: 'High confidence' },
    { ...validSummary, risk_level: 'MEDIUM' },
    { ...validSummary, work_auth: 'not-sure' },
    { ...validSummary, final_decision: 'maybe' },
    { ...validSummary, confidence: 'medium' },
    { ...validSummary, archetype: '' },
    { ...validSummary, next_action: '' },
  ];
  for (const c of cases) {
    assert.notEqual(validateMachineSummary(c).length, 0, JSON.stringify(c));
  }
});

test('validateMachineSummary rejects non-null primitives where the contract needs types', () => {
  const cases = [
    { ...validSummary, via: 5 },
    { ...validSummary, company_confidential: 'false' },
    { ...validSummary, advertised_comp: true },
    { ...validSummary, reports_to: {} },
    { ...validSummary, hard_stops: ['ok', 7] },
    { ...validSummary, soft_gaps: 'not an array' },
  ];
  for (const c of cases) {
    assert.notEqual(validateMachineSummary(c).length, 0);
  }
});

test('validateMachineSummary enforces the requirement_importance gates', () => {
  const statedWithoutQuote = {
    ...validSummary,
    requirement_importance: [{ requirement: 'LLM evals', jd_signal: null, evidence: 'stated', importance: 'high', match: 'strong' }],
  };
  const problemsStated = validateMachineSummary(statedWithoutQuote);
  assert.match(problemsStated.join('\n'), /evidence "stated" requires a non-null verbatim jd_signal/);

  const inferredCritical = {
    ...validSummary,
    requirement_importance: [{ requirement: 'Knows the stack', jd_signal: null, evidence: 'inferred', importance: 'critical', match: 'na' }],
  };
  const problemsInferred = validateMachineSummary(inferredCritical);
  assert.match(problemsInferred.join('\n'), /evidence "inferred" cannot carry importance/);

  const badEnums = {
    ...validSummary,
    requirement_importance: [{ requirement: 'X', jd_signal: 'y', evidence: 'guessed', importance: 'crucial', match: 'strong' }],
  };
  assert.notEqual(validateMachineSummary(badEnums).length, 0);
});

test('validateMachineSummary checks every risk_summary verdict enum', () => {
  for (const key of Object.keys(RISK_SUMMARY_ENUMS)) {
    const bad = { ...validSummary, risk_summary: { ...validSummary.risk_summary, [key]: 'sideways' } };
    const problems = validateMachineSummary(bad);
    assert.match(problems.join('\n'), new RegExp(`risk_summary\\.${key}: expected one of`));
  }
  const missing = { ...validSummary, risk_summary: { legitimacy: 'clear' } };
  assert.match(validateMachineSummary(missing).join('\n'), /risk_summary\.classification: must be a string/);
});

test('renderMachineSummaryYaml round-trips through js-yaml to an equal object', () => {
  const yaml = renderMachineSummaryYaml(validSummary);
  const parsed = yamlLoad(yaml);
  assert.deepEqual(parsed, validSummary);
});

test('renderMachineSummaryYaml outputs contract-shaped YAML (quoted strings, [] lists, typed nulls)', () => {
  const yaml = renderMachineSummaryYaml(validSummary);
  assert.match(yaml, /company: ['"]Acme Corp['"]/);
  assert.match(yaml, /hard_stops: \[\]/);
  assert.match(yaml, /discard_reasons: \[\]/);
  assert.match(yaml, /score: 4.2/);
  assert.match(yaml, /\nvia: null\n/);
  assert.match(yaml, /company_confidential: false/);
  assert.match(yaml, /advertised_comp: ['"]80-90k EUR['"]/);
});

test('renderMachineSummaryYaml follows the contract field order', () => {
  const yaml = renderMachineSummaryYaml(validSummary);
  const lines = yaml.split('\n').map((l) => l.replace(/^([A-Za-z_]+):.*$/, '$1'));
  const order = MACHINE_SUMMARY_FIELDS.filter((k) => validSummary[k] !== undefined);
  let idx = 0;
  for (const key of order) {
    const pos = lines.indexOf(key);
    assert.ok(pos >= idx, `field order violated for ${key}`);
    idx = pos;
  }
});

test('extractMachineSummary parses a fenced block from markdown', () => {
  const md = '# report\n\n## Machine Summary\n\n```yaml\n' + renderMachineSummaryYaml(validSummary) + '\n```\n\nrest\n';
  const parsed = extractMachineSummary(md);
  assert.deepEqual(parsed, validSummary);
});

test('extractMachineSummary handles json-tagged and yml-tagged fences', () => {
  const jsonMd = '## Machine Summary\n\n```json\n' + renderMachineSummaryYaml(validSummary) + '\n```\n';
  assert.deepEqual(extractMachineSummary(jsonMd), validSummary);
  const ymlMd = '## Machine Summary\n\n```yml\n' + renderMachineSummaryYaml(validSummary) + '\n```\n';
  assert.deepEqual(extractMachineSummary(ymlMd), validSummary);
});

test('extractMachineSummary returns null on absent, empty, or malformed blocks', () => {
  assert.equal(extractMachineSummary('no block here'), null);
  assert.equal(extractMachineSummary('## Machine Summary\n\n```yaml\n\n```\n'), null);
  assert.equal(extractMachineSummary('## Machine Summary\n\n```yaml\n[1, 2,\n```'), null);
  assert.equal(extractMachineSummary('## Machine Summary\n\n```yaml\njust words\n```\n'), null);
  assert.equal(extractMachineSummary(undefined), null);
});

test('rendered block validates after a full round trip', () => {
  const md = '## Machine Summary\n\n```yaml\n' + renderMachineSummaryYaml(validSummary) + '\n```\n';
  const parsed = extractMachineSummary(md);
  assert.equal(isValidMachineSummary(parsed), true);
});