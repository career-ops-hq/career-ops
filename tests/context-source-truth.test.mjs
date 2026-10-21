import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compressSharedContext, buildBudgetedPrompt } from '../lib/context-budget.mjs';

const shared = readFileSync(new URL('../modes/_shared.md', import.meta.url), 'utf8');
const truth = shared.match(/^## Sources of Truth[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/m)?.[0];

function check(label, run) {
  try {
    run();
    pass(label);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
}

check('exhaustive compression preserves the full candidate source-of-truth contract', () => {
  assert.ok(truth);
  const result = compressSharedContext(shared, Number.MAX_SAFE_INTEGER);
  assert.ok(result.compressed.includes(truth));
  assert.equal(result.removed.includes('Sources of Truth (EXCLUSIVE)'), false);
});

check('an impossible budget retains candidate fact rules and reports the remaining overflow', () => {
  assert.ok(truth);
  const result = buildBudgetedPrompt({ sharedContent: shared, cvContent: 'Synthetic CV', jdText: 'Synthetic JD', maxTokens: 1, safetyMargin: 0 });
  assert.ok(result.contextBody.includes(truth));
  assert.equal(result.budgetReport.overBudget, true);
});
