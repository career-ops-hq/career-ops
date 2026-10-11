import { pass, fail } from './helpers.mjs';
import { buildBudgetedPrompt, DEFAULT_MAX_TOKENS, DEFAULT_SAFETY_MARGIN } from '../lib/context-budget.mjs';

const cases = [["MiniMax-M3", 1000000], ["MiniMax-M2.7", 204800]];
for (const [modelName, contextWindow] of cases) {
  const jdText = 'x'.repeat((DEFAULT_MAX_TOKENS + 1000) * 4);
  const result = buildBudgetedPrompt({ modelName, jdText });
  if (result.budgetReport.budget === contextWindow - DEFAULT_SAFETY_MARGIN
      && !result.budgetReport.overBudget) {
    pass(modelName + ' accepts a prompt above the fallback context budget');
  } else {
    fail(modelName + ' did not use its context window');
  }
  const oversized = buildBudgetedPrompt({ modelName, jdText: 'x'.repeat(contextWindow * 4) });
  if (oversized.budgetReport.overBudget) pass(modelName + ' reserves output space');
  else fail(modelName + ' did not reserve output space');
  const override = buildBudgetedPrompt({ modelName, maxTokens: 16000 });
  if (override.budgetReport.budget === 16000 - DEFAULT_SAFETY_MARGIN) pass(modelName + ' honors an explicit budget');
  else fail(modelName + ' ignored an explicit budget');
}
for (const modelName of [undefined, 'unknown-model', 'constructor']) {
  const result = buildBudgetedPrompt({ modelName });
  if (result.budgetReport.budget === DEFAULT_MAX_TOKENS - DEFAULT_SAFETY_MARGIN) pass('Unknown models retain the default context budget');
  else fail('Unknown model changed the default context budget');
}
