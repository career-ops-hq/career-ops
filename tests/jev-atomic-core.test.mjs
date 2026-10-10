/**
 * tests/jev-atomic-core.test.mjs — the foundation schemas and decoders that
 * back Envelope B's "Jev decides enums, LLM writes prose only".
 *
 * The rules under test, in priority order:
 *   1. Every shipped Block A/D/G question validates under the Jev payload
 *      contract (choice <= 255 options, score 2-10 ordered levels, noul for
 *      booleans) — a malformed schema is a build-time defect, not a runtime
 *      mystery.
 *   2. `toApiQuestions` strips caller metadata (machineField) so the wire
 *      payload is exactly the API contract and nothing else.
 *   3. Decoding surfaces the raw probability vector and confidence score, not
 *      just the argmax — the confidence-gated escalation policy is built on
 *      these, so dropping them would silently disable reruns.
 *   4. The question sets are frozen data. `_profile.md`/`_custom.md` can *add*
 *      schemas, but nothing at runtime may mutate the shipped ones.
 *
 * Hermetic: pure functions, no network, no API key. The gatekeeper decide-mode
 * CLI contract is covered separately by jev-gatekeeper-decide.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_QUESTIONS,
  BLOCK_A_QUESTIONS,
  BLOCK_D_QUESTIONS,
  BLOCK_G_QUESTIONS,
  BLOCKS,
  CORE_VERSION,
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_BLOCKS,
  MAX_CHOICE_OPTIONS,
  QUESTION_TYPES,
  SCORE_MAX_LEVELS,
  SCORE_MIN_LEVELS,
  applyMicroDecisions,
  buildRequest,
  confidenceEscalations,
  criticalCategoricalDecisions,
  decodeAnswer,
  decodeAnswers,
  escalateCriticalCategories,
  escalationWhen,
  isCriticalCategorical,
  isolatedMicroPayload,
  lowConfidenceQuestions,
  machineSummaryFields,
  machineSummaryFrom,
  normalizeType,
  questionsForBlocks,
  toApiQuestions,
  validateQuestion,
  validateQuestionSet,
} from '../lib/jev-atomic-core.mjs';

// --- shipped schemas are valid ---

test('every block validates under the Jev payload contract', () => {
  for (const [key, set] of Object.entries(BLOCKS)) {
    const v = validateQuestionSet(set);
    assert.equal(v.ok, true, `block ${key} invalid: ${v.errors.join('; ')}`);
  }
  assert.deepEqual(Object.keys(BLOCKS), DEFAULT_BLOCKS);
});

test('the shipped sets merge to 21 questions (A=8, D=4, G=9)', () => {
  assert.equal(Object.keys(BLOCK_A_QUESTIONS).length, 8);
  assert.equal(Object.keys(BLOCK_D_QUESTIONS).length, 4);
  assert.equal(Object.keys(BLOCK_G_QUESTIONS).length, 9);
  assert.equal(Object.keys(ALL_QUESTIONS).length, 21);
  assert.equal(Object.keys(questionsForBlocks()).length, 21);
});

test('questionsForBlocks rejects an unknown block loudly', () => {
  assert.throws(() => questionsForBlocks(['A', 'Z']), /unknown block/);
});

// --- type normalization ---

test('normalizeType maps the boolean alias and rejects junk', () => {
  assert.equal(normalizeType('boolean'), QUESTION_TYPES.BOOLEAN);
  assert.equal(normalizeType(' noul '), QUESTION_TYPES.BOOLEAN);
  assert.equal(normalizeType('choice'), QUESTION_TYPES.CHOICE);
  assert.equal(normalizeType('score'), QUESTION_TYPES.SCORE);
  assert.equal(normalizeType('BOOLEAN'), QUESTION_TYPES.BOOLEAN, 'case-insensitive');
  assert.equal(normalizeType('yes'), null);
  assert.equal(normalizeType(3), null);
  assert.equal(normalizeType(''), null);
});

// --- validation rules ---

test('a valid choice passes validation', () => {
  const v = validateQuestion('q', {
    type: 'choice',
    instructions: 'pick one',
    criteria: { a: 'A', b: 'B' },
  });
  assert.equal(v.ok, true);
  assert.equal(v.type, 'choice');
});

test('choice with a single option is rejected', () => {
  const v = validateQuestion('q', { type: 'choice', instructions: 'x', criteria: { only: 'one' } });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /at least 2 options/);
});

test('choice over the 255-cap is rejected', () => {
  const criteria = {};
  for (let i = 0; i < MAX_CHOICE_OPTIONS + 1; i++) criteria[`k${i}`] = `option ${i}`;
  const v = validateQuestion('q', { type: 'choice', instructions: 'x', criteria });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /255/);
});

test('choice with an empty option description is rejected', () => {
  const v = validateQuestion('q', { type: 'choice', instructions: 'x', criteria: { a: '', b: 'B' } });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /non-empty description/);
});

test('score needs 2-10 ordered levels', () => {
  const one = validateQuestion('q', { type: 'score', instructions: 'x', criteria: ['only'] });
  assert.equal(one.ok, false);
  assert.match(one.errors[0], /at least 2/);

  const many = [];
  for (let i = 0; i < SCORE_MAX_LEVELS + 1; i++) many.push(`l${i}`);
  const over = validateQuestion('q', { type: 'score', instructions: 'x', criteria: many });
  assert.equal(over.ok, false);
  assert.match(over.errors[0], /10 cap/);

  const good = validateQuestion('q', { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c'] });
  assert.equal(good.ok, true);
});

test('boolean (noul) accepts optional true/false criteria', () => {
  const plain = validateQuestion('q', { type: 'boolean', instructions: 'x' });
  assert.equal(plain.ok, true);
  const withDesc = validateQuestion('q', { type: 'noul', instructions: 'x', criteria: { true: 'yes', false: 'no' } });
  assert.equal(withDesc.ok, true);
  const bad = validateQuestion('q', { type: 'noul', instructions: 'x', criteria: 'nope' });
  assert.equal(bad.ok, false);
});

test('unknown types and blank instructions are rejected', () => {
  const badType = validateQuestion('q', { type: 'quantile', instructions: 'x' });
  assert.equal(badType.ok, false);
  assert.match(badType.errors[0], /unsupported/);

  const noInstr = validateQuestion('q', { type: 'noul', instructions: '  ' });
  assert.equal(noInstr.ok, false);
  assert.match(noInstr.errors[0], /instructions/);

  const notObj = validateQuestion('q', null);
  assert.equal(notObj.ok, false);
});

test('validateQuestionSet reports failures per-name', () => {
  const v = validateQuestionSet({
    good: { type: 'noul', instructions: 'x' },
    bad: { type: 'choice', instructions: '', criteria: { only: 'one' } },
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith('bad:')));
  assert.equal(validateQuestionSet({}).ok, false);
  assert.equal(validateQuestionSet(null).ok, false);
});

// --- payload building ---

test('toApiQuestions strips machineField and normalizes boolean', () => {
  const api = toApiQuestions(BLOCK_G_QUESTIONS);
  for (const q of Object.values(api)) {
    assert.equal('machineField' in q, false, 'metadata must never reach the wire');
  }
  assert.equal(Object.keys(api)[0], 'legitimacy_tier');
  assert.equal(api.repost_signal.type, 'noul');
  assert.ok(Array.isArray(api.description_quality.criteria));
  assert.equal(typeof api.legitimacy_tier.criteria, 'object');
});

test('buildRequest emits escalation as providerOptions.gateway.models', () => {
  const req = buildRequest({
    model: 'typesafe-ai/jev',
    state: 'RESUME: hi\n\nJOB: yo',
    questions: BLOCK_G_QUESTIONS,
    escalation: [{ model: 'stronger-lm', question: 'legitimacy_tier', confidenceBelow: 0.5 }],
  });
  assert.deepEqual(req.providerOptions, { gateway: { models: [{ model: 'stronger-lm', when: { question: 'legitimacy_tier', confidenceBelow: 0.5 } }] } });
  assert.equal('machineField' in req.questions.legitimacy_tier, false);
});

test('buildRequest applies the default confidence floor and omits providerOptions when clean', () => {
  const req = buildRequest({ model: 'm', state: 's', questions: BLOCK_D_QUESTIONS, escalation: [{ model: 'lm', question: 'company_type' }] });
  assert.equal(req.providerOptions.gateway.models[0].when.confidenceBelow, DEFAULT_CONFIDENCE_FLOOR);

  const clean = buildRequest({ model: 'm', state: 's', questions: BLOCK_D_QUESTIONS });
  assert.equal('providerOptions' in clean, false);
});

test('buildRequest requires model and state', () => {
  assert.throws(() => buildRequest({ state: 's', questions: BLOCK_D_QUESTIONS }), /model/);
  assert.throws(() => buildRequest({ model: 'm', questions: BLOCK_D_QUESTIONS }), /state/);
  assert.throws(() => buildRequest({ model: 'm', state: 's' }), /questions/);
});

test('escalationWhen and confidenceEscalations build valid gateway rules', () => {
  assert.deepEqual(escalationWhen('q', 0.4, 'lm'), { model: 'lm', when: { question: 'q', confidenceBelow: 0.4 } });
  assert.throws(() => escalationWhen('', 0.4, 'lm'), /question/);
  assert.throws(() => escalationWhen('q', 0.4, ''), /model/);
  assert.throws(() => confidenceEscalations({ q: { confidence: 0.1 } }, { threshold: 0.5 }), /model/);
});

test('lowConfidenceQuestions only flags numeric confidences below the floor', () => {
  const decoded = {
    a: { confidence: 0.1 },
    b: { confidence: 0.9 },
    c: { confidence: null },
    d: 'not an object',
  };
  assert.deepEqual(lowConfidenceQuestions(decoded, { threshold: 0.5 }), ['a']);
  assert.deepEqual(lowConfidenceQuestions(decoded), lowConfidenceQuestions(decoded, { threshold: DEFAULT_CONFIDENCE_FLOOR }));
  assert.deepEqual(lowConfidenceQuestions(null), []);
});

// --- confidence escalation (micro-LLM string evaluation, Item 2) ---

/** A critical categorical is a `choice` mapping to a machineField, or an
 * explicit `critical: true` — the Machine Summary enums. Anything else (plain
 * choices, scores, booleans) is not worth a micro re-decision. */
const ESQ = {
  machine: { type: 'choice', instructions: 'pick a', criteria: { a: 'A', b: 'B' }, machineField: 'archetype' },
  flagged: { type: 'choice', instructions: 'pick c', criteria: { c: 'C', d: 'D' }, critical: true },
  plain: { type: 'choice', instructions: 'pick x', criteria: { x: 'X', y: 'Y' } },
  score: { type: 'score', instructions: 'rate', criteria: [1, 2, 3], machineField: 'risk_level' },
};

test('isCriticalCategorical flags exactly the Machine Summary choice enums', () => {
  assert.equal(isCriticalCategorical(ESQ.machine), true);
  assert.equal(isCriticalCategorical(ESQ.flagged), true);
  assert.equal(isCriticalCategorical(ESQ.plain), false);
  assert.equal(isCriticalCategorical(ESQ.score), false);
  assert.equal(isCriticalCategorical({ type: 'noul' }), false);
  assert.equal(isCriticalCategorical(null), false);
  assert.equal(isCriticalCategorical('nope'), false);
});

test('criticalCategoricalDecisions targets only low-confidence machine enums with a value', () => {
  const decoded = {
    machine: { value: 'a', confidence: 0.4, error: null },
    flagged: { value: 'c', confidence: 0.9, error: null },
    plain: { value: 'x', confidence: 0.2, error: null },
    score: { value: 2, confidence: 0.3, error: null },
  };
  const names = criticalCategoricalDecisions(decoded, ESQ).map((t) => t.name);
  assert.deepEqual(names, ['machine'], 'only the below-floor machine enum is a target');

  assert.deepEqual(
    criticalCategoricalDecisions(decoded, ESQ, { threshold: 0.95 }).map((t) => t.name).sort(),
    ['flagged', 'machine'],
    'the explicit critical:true enum escalates too; scores/plain choices never do',
  );

  assert.deepEqual(
    criticalCategoricalDecisions(
      { machine: { value: 'a', confidence: null, error: null } },
      ESQ,
    ),
    [],
    'a null confidence is not a target (there is nothing to escalate against)',
  );
  assert.deepEqual(
    criticalCategoricalDecisions(
      { machine: { value: null, confidence: 0.2, error: null } },
      ESQ,
    ),
    [],
    'an unanswered machine enum is not a target',
  );
  assert.deepEqual(criticalCategoricalDecisions(null, ESQ), []);
  assert.deepEqual(criticalCategoricalDecisions({}, null), []);
});

test('isolatedMicroPayload carries ONLY the one key, its option set and the original', () => {
  const p = isolatedMicroPayload('machine', ESQ.machine, { value: 'a', confidence: 0.4 });
  assert.equal(p.kind, 'micro-escalation');
  assert.equal(p.question.name, 'machine');
  assert.equal(p.question.type, 'choice');
  assert.deepEqual(p.question.criteria, { a: 'A', b: 'B' });
  assert.equal(p.question.machineField, 'archetype');
  assert.deepEqual(p.originally, { value: 'a', confidence: 0.4 });
  assert.ok(!('questions' in p), 'the rest of the run never leaks into the payload');

  assert.throws(() => isolatedMicroPayload('', ESQ.machine), /name/);
  assert.throws(() => isolatedMicroPayload('plain', ESQ.plain), /not a critical categorical/);
  assert.throws(() => isolatedMicroPayload('score', ESQ.score), /not a critical categorical/);
});

test('applyMicroDecisions merges micro strings and reports every failure advisory', () => {
  const decoded = {
    machine: { value: 'a', confidence: 0.4, machineField: 'archetype', error: null },
    flagged: { value: 'c', confidence: 0.3, machineField: null, error: null },
  };
  const merged = applyMicroDecisions(ESQ, decoded, [
    { name: 'machine', value: 'b', confidence: 0.98 },
    { name: 'flagged', value: 'd' },
    { name: 'plain', value: 'x' },
    { name: 'machine', value: '' },
    { name: 'machine', value: 'zzz' },
  ]);
  assert.deepEqual(merged.escalated, ['machine', 'flagged'], 'both critical enums re-decided');
  assert.equal(merged.decoded.machine.value, 'b');
  assert.equal(merged.decoded.machine.escalated, true);
  assert.equal(merged.decoded.machine.escalationConfidence, 0.98);
  assert.equal(merged.decoded.flagged.value, 'd');
  assert.equal(merged.decoded.flagged.escalationConfidence, 1, 'default resolved confidence when the micro result carries none');
  assert.ok(!('plain' in merged.decoded), 'non-target names never enter the decoded set');
  assert.equal(Object.keys(merged.failures).length, 3, 'non-target, empty and unmatched options are each a failure');
  assert.match(merged.failures[0].reason, /not a critical-categorical target/);
  assert.match(merged.failures[1].reason, /returned no option string/);
  assert.match(merged.failures[2].reason, /not among the question's own criteria keys/);
});

test('escalateCriticalCategories intercepts the run and re-decides only the flagged keys', () => {
  const decoded = {
    machine: { value: 'a', confidence: 0.4, machineField: 'archetype', error: null },
    plain: { value: 'x', confidence: 0.2, error: null },
  };
  const calls = [];
  const runMicro = (payload) => {
    calls.push(payload.question.name);
    return { name: payload.question.name, value: 'b', confidence: 0.97 };
  };
  const out = escalateCriticalCategories({ questions: ESQ, decoded, runMicro });
  assert.deepEqual(calls, ['machine'], 'only the one below-floor critical key is evaluated');
  assert.deepEqual(out.escalated, ['machine']);
  assert.equal(out.decoded.machine.value, 'b');
  assert.ok(out.unchanged.includes('plain'));
  assert.equal(out.targets, 1);
  assert.equal(out.failures.length, 0);
  assert.equal(machineSummaryFrom(out.decoded).archetype, 'b', 'the envelope machine map reflects the escalation');

  const again = escalateCriticalCategories({ questions: ESQ, decoded: out.decoded, runMicro });
  assert.equal(again.targets, 0, 're-decided keys are above the floor and not re-escalated');
  assert.deepEqual(again.escalated, []);
});

test('escalateCriticalCategories is advisory: a failing micro evaluator keeps the original', () => {
  const decoded = { flagged: { value: 'c', confidence: 0.3, error: null } };
  const out = escalateCriticalCategories({
    questions: ESQ,
    decoded,
    runMicro: () => { throw new Error('provider down'); },
  });
  assert.equal(out.decoded.flagged.value, 'c', 'original low-confidence decision survives');
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0].reason, /provider down/);
});

test('escalateCriticalCategories requires an evaluator only when targets exist', () => {
  const clean = { machine: { value: 'a', confidence: 0.9, error: null } };
  const dirty = { machine: { value: 'a', confidence: 0.4, error: null } };
  assert.throws(() => escalateCriticalCategories({ questions: ESQ, decoded: dirty }), /runMicro/);
  const out = escalateCriticalCategories({ questions: ESQ, decoded: clean });
  assert.equal(out.targets, 0);
  assert.deepEqual(out.escalated, []);
  assert.deepEqual(out.failures, []);
});

// --- decoding ---

test('decodeAnswer noul: boolean value plus the raw probability', () => {
  const yes = decodeAnswer('q', { type: 'noul' }, { noul: 0.81 });
  assert.equal(yes.value, true);
  assert.equal(yes.probability, 0.81);
  assert.equal(yes.error, null);

  const no = decodeAnswer('q', { type: 'boolean' }, { probability: 0.2 });
  assert.equal(no.value, false);
  assert.equal(no.probability, 0.2);
});

test('decodeAnswer score: numeric level plus probabilities and confidence', () => {
  const d = decodeAnswer('q', { type: 'score' }, {
    score: 3,
    probabilities: { 1: 0, 2: 0.1, 3: 0.8, 4: 0.1 },
    providerMetadata: { typesafe: { confidence: 0.92 } },
  });
  assert.equal(d.value, 3);
  assert.deepEqual(d.probabilities, { 1: 0, 2: 0.1, 3: 0.8, 4: 0.1 });
  assert.equal(d.confidence, 0.92);
});

test('decodeAnswer choice: option key with a confidence vector', () => {
  const d = decodeAnswer('q', { type: 'choice', machineField: 'x' }, {
    choice: 'agentic_automation',
    probabilities: { agentic_automation: 0.7, technical_ai_pm: 0.3 },
    confidence: 0.61,
  });
  assert.equal(d.value, 'agentic_automation');
  assert.equal(d.machineField, 'x');
  assert.equal(d.confidence, 0.61);
});

test('decodeAnswer surfaces missing answers and malformed shapes as errors, not crashes', () => {
  assert.match(decodeAnswer('q', { type: 'noul' }, {}).error, /missing noul/);
  assert.match(decodeAnswer('q', { type: 'choice' }, { choice: 5 }).error, /missing choice/);
  assert.match(decodeAnswer('q', { type: 'score' }, { score: 'high' }).error, /missing numeric/);
  assert.equal(decodeAnswer('q', { type: 'noul' }, 'nope').error, 'answer was not an object');
  assert.equal(decodeAnswer('q', { type: 'noul' }, null).raw, null);
  assert.match(decodeAnswer('q', { type: 'quantile' }, {}).error, /unknown answer type/);
});

test('decodeAnswers marks absent answers and carries machineField through', () => {
  const decoded = decodeAnswers(BLOCK_G_QUESTIONS, {
    legitimacy_tier: { choice: 'suspicious', confidence: 0.8 },
  });
  assert.equal(decoded.legitimacy_tier.value, 'suspicious');
  assert.equal(decoded.legitimacy_tier.machineField, 'legitimacy_tier');
  assert.equal(decoded.risk_level.error, 'missing answer');
  assert.equal(Object.keys(decoded).length, Object.keys(BLOCK_G_QUESTIONS).length);
});

// --- machine summary mapping ---

test('machineSummaryFields exposes the Module Summary key per mapped decision', () => {
  const fields = machineSummaryFields(ALL_QUESTIONS);
  assert.deepEqual(fields, {
    archetype: 'archetype',
    work_authorization: 'work_auth',
    legitimacy_tier: 'legitimacy_tier',
    risk_level: 'risk_level',
  });
});

test('machineSummaryFrom maps decoded values without inventing absent ones', () => {
  const decoded = decodeAnswers(BLOCK_G_QUESTIONS, {
    legitimacy_tier: { choice: 'proceed_with_caution' },
    risk_level: { choice: 'medium' },
  });
  assert.deepEqual(machineSummaryFrom(decoded), {
    legitimacy_tier: 'proceed_with_caution',
    risk_level: 'medium',
  });
  assert.deepEqual(machineSummaryFrom(null), {});
});

// --- the shipped schemas are frozen data ---

test('shipped question sets are deeply frozen', () => {
  assert.throws(() => { ALL_QUESTIONS.archetype.criteria.other = 'mutated'; }, TypeError);
  assert.throws(() => { BLOCK_G_QUESTIONS.legitimacy_tier.instructions = 'mutated'; }, TypeError);
  assert.throws(() => { BLOCKS.A.remote.options = {}; }, TypeError);
  assert.equal(Object.isFrozen(ALL_QUESTIONS), true);
  assert.equal(ALL_QUESTIONS.archetype.machineField, 'archetype');
});

test('CORE_VERSION is a semantic version string', () => {
  assert.match(CORE_VERSION, /^\d+\.\d+\.\d+$/);
});