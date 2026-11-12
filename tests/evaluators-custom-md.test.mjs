/**
 * tests/evaluators-custom-md.test.mjs — modes/_custom.md reaches every evaluator
 *
 * modes/_shared.md reads the user's modes/_custom.md "ALWAYS" and applies its
 * Scoring Rules to the Global score, and batch/batch-prompt.md honours it. The
 * standalone evaluators (openai-eval, gemini-eval, ollama-eval,
 * batch-evaluate-gemini) must pass it to the model as well, or house rules and
 * scoring rules silently stop applying depending on which evaluator ran.
 *
 * Covers:
 *   1. buildBudgetedPrompt({ customContent }) — labelled section, ordering,
 *      omitted when empty, never compressed away.
 *   2. gemini-eval.mjs --context-only — behavioural: a present _custom.md
 *      grows the prompt, an absent one is a valid end state (no warning).
 *   3. Source guard over all four evaluators so the siblings cannot drift
 *      apart again (the _profile.md wiring did, see #5202).
 *
 * Run: node --test tests/evaluators-custom-md.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBudgetedPrompt } from '../lib/context-budget.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const CUSTOM_HEADER = 'USER HOUSE RULES & SCORING RULES (_custom.md)';
const CUSTOM_BODY = 'Scoring Rules: add +0.3 for target-account companies.';

// A _shared.md large enough to be worth compressing, made of P2 sections.
const bigShared = ['<!-- preamble -->\n']
  .concat(Array.from({ length: 6 }, (_, i) => `## Voice DNA ${i}\n${'filler '.repeat(2000)}\n`))
  .join('\n');

const base = {
  sharedContent: '## Scoring System\nscore things\n',
  ofertaContent: 'oferta logic',
  cvContent: 'my cv',
  profileContent: 'my profile',
  jdText: 'the job',
};

test('customContent renders a labelled _custom.md section', () => {
  const { contextBody } = buildBudgetedPrompt({ ...base, customContent: CUSTOM_BODY });
  assert.ok(contextBody.includes(CUSTOM_HEADER), 'missing _custom.md header');
  assert.ok(contextBody.includes(CUSTOM_BODY), 'missing _custom.md content');
});

test('_custom.md sits right after _profile.md and before the JD', () => {
  const { contextBody } = buildBudgetedPrompt({ ...base, customContent: CUSTOM_BODY });
  const profileAt = contextBody.indexOf('USER ARCHETYPES & NARRATIVE (_profile.md)');
  const customAt = contextBody.indexOf(CUSTOM_HEADER);
  const jdAt = contextBody.indexOf('JOB DESCRIPTION');
  assert.ok(profileAt >= 0 && profileAt < customAt, '_custom.md must follow _profile.md');
  assert.ok(customAt < jdAt, '_custom.md must precede the JD');
});

test('empty or omitted customContent emits no _custom.md section', () => {
  for (const opts of [base, { ...base, customContent: '' }]) {
    const { contextBody } = buildBudgetedPrompt(opts);
    assert.ok(!contextBody.includes('_custom.md'), 'unexpected _custom.md section');
    assert.ok(!contextBody.includes(CUSTOM_HEADER));
  }
});

test('_custom.md is never removed by compression under a tight budget', () => {
  const { contextBody, budgetReport } = buildBudgetedPrompt({
    ...base,
    sharedContent: bigShared,
    customContent: CUSTOM_BODY,
    maxTokens: 12000,
    safetyMargin: 1000,
  });
  assert.ok(budgetReport.compressed, 'fixture must force compression');
  assert.ok(budgetReport.removed.length > 0);
  assert.ok(!budgetReport.removed.includes('_custom.md'));
  assert.ok(contextBody.includes(CUSTOM_BODY), '_custom.md was dropped by compression');
});

// ---------------------------------------------------------------------------
// Behavioural: gemini-eval.mjs --context-only never calls the network and
// reports the assembled prompt's token budget.
// ---------------------------------------------------------------------------
function geminiContextOnly(customMd) {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-custom-md-'));
  try {
    mkdirSync(join(tmp, 'config'), { recursive: true });
    mkdirSync(join(tmp, 'modes'), { recursive: true });
    writeFileSync(join(tmp, 'config', 'profile.yml'), 'candidate:\n  full_name: Test\n', 'utf-8');
    writeFileSync(join(tmp, 'cv.md'), 'My CV', 'utf-8');
    writeFileSync(join(tmp, 'modes', '_profile.md'), 'My Profile', 'utf-8');
    if (customMd !== null) writeFileSync(join(tmp, 'modes', '_custom.md'), customMd, 'utf-8');
    writeFileSync(join(tmp, 'jd.txt'), 'Job description text', 'utf-8');
    const r = spawnSync(process.execPath, [join(ROOT, 'gemini-eval.mjs'), '--file', join(tmp, 'jd.txt'), '--no-save', '--context-only'], {
      cwd: tmp,
      env: { ...process.env, GEMINI_API_KEY: 'mock-api-key-12345', CAREER_OPS_ROOT: tmp },
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.equal(r.status, 0, r.stderr || r.error?.message);
    return {
      tokens: Number((r.stdout.match(/Token budget: (\d+) tokens/) ?? [])[1]),
      output: `${r.stdout}\n${r.stderr}`,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('gemini-eval: a present _custom.md grows the prompt; an absent one is silent', () => {
  const without = geminiContextOnly(null);
  const withCustom = geminiContextOnly('Scoring Rules: ' + 'house rule '.repeat(400));
  assert.ok(Number.isFinite(without.tokens) && Number.isFinite(withCustom.tokens));
  assert.ok(withCustom.tokens > without.tokens + 500,
    `_custom.md was not loaded (${without.tokens} -> ${withCustom.tokens} tokens)`);
  assert.ok(!/_custom\.md/.test(without.output), 'absent _custom.md must not warn');
});

// ---------------------------------------------------------------------------
// Source guard: all four evaluators load _custom.md from the DATA_ROOT the
// same way they load _profile.md, and the siblings stay in step.
// ---------------------------------------------------------------------------
const EVALUATORS = [
  { file: 'openai-eval.mjs', budgeted: true },
  { file: 'gemini-eval.mjs', budgeted: true },
  { file: 'ollama-eval.mjs', budgeted: true },
  { file: 'batch-evaluate-gemini.mjs', budgeted: false },
];

for (const { file, budgeted } of EVALUATORS) {
  test(`${file} loads modes/_custom.md from the data root`, () => {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    assert.match(src, /join\(DATA_ROOT, 'modes', '_custom\.md'\)/, 'must resolve _custom.md under DATA_ROOT');
    assert.match(src, /customContent/, 'must read _custom.md into customContent');
    assert.match(src, /existsSync\(PATHS\.custom\)/, '_custom.md is optional: guard with existsSync, not the required readFile');
    if (budgeted) {
      assert.match(src, /^\s*customContent,$/m, 'must pass customContent to buildBudgetedPrompt');
      assert.match(src, /^\s*profileContent,$/m, 'must still pass profileContent to buildBudgetedPrompt');
    } else {
      assert.match(src, /\$\{customContent\}/, 'must interpolate customContent into the system prompt');
      assert.match(src, /\$\{profileContent\}/, 'must still interpolate profileContent');
    }
  });
}
