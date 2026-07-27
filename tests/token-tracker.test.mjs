// tests/token-tracker.test.mjs — token tracking & cost estimation unit tests
import { pass, fail } from './helpers.mjs';
import { estimateCost, TokenAccumulator, formatBreakdown } from '../utils/token-tracker.mjs';
import { parseTokenVal } from '../batch/aggregate-tokens.mjs';

console.log('\ntoken-tracker.mjs & aggregate-tokens.mjs unit tests');

try {
  // 1. parseTokenVal (from batch/aggregate-tokens.mjs)
  const val1 = parseTokenVal('12.4k');
  const val2 = parseTokenVal('1,234');
  const val3 = parseTokenVal('');
  const val4 = parseTokenVal('500');

  if (val1 === 12400 && val2 === 1234 && val3 === 0 && val4 === 500) {
    pass('parseTokenVal correctly parses "12.4k" → 12400, "1,234" → 1234, "" → 0, "500" → 500');
  } else {
    fail(`parseTokenVal failed: val1=${val1}, val2=${val2}, val3=${val3}, val4=${val4}`);
  }

  // 2. estimateCost for a known model (gpt-4o-mini, openai)
  // RATES['gpt-4o-mini'] = { input: 0.150 / 1e6, output: 0.600 / 1e6 }
  // 1000 input tokens = $0.00015, 500 output tokens = $0.00030 -> total $0.00045
  const usage = { prompt_tokens: 1000, completion_tokens: 500, cached_tokens: 0 };
  const costKnown = estimateCost('gpt-4o-mini', usage, 'openai');
  const expectedCost = 0.00045;
  if (costKnown !== null && Math.abs(costKnown - expectedCost) < 1e-9) {
    pass('estimateCost for gpt-4o-mini matches hand-calculated cost ($0.00045)');
  } else {
    fail(`estimateCost for gpt-4o-mini failed: expected ${expectedCost}, got ${costKnown}`);
  }

  // 3. OpenRouter :free / free-rotation exemption
  const origModelEnv = process.env.CAREER_OPS_MODEL;
  delete process.env.CAREER_OPS_MODEL;
  const freeCost = estimateCost('meta-llama/llama-3.1-70b-instruct:free', usage, 'openrouter');
  if (origModelEnv !== undefined) {
    process.env.CAREER_OPS_MODEL = origModelEnv;
  }
  if (freeCost === 0) {
    pass('OpenRouter :free / free-rotation exemption returns 0 cost when no CAREER_OPS_MODEL is pinned');
  } else {
    fail(`OpenRouter free exemption failed: expected 0, got ${freeCost}`);
  }

  // 4. Ollama → estimateCost always returns 0 regardless of model
  const ollamaCost = estimateCost('llama3:latest', usage, 'ollama');
  if (ollamaCost === 0) {
    pass('Ollama estimateCost always returns 0 regardless of model');
  } else {
    fail(`Ollama estimateCost failed: expected 0, got ${ollamaCost}`);
  }

  // 5. Unknown model/provider fallback → estimateCost returns null
  const unknownCost = estimateCost('completely-unknown-model-xyz', usage, 'unknown-provider');
  if (unknownCost === null) {
    pass('Unknown model/provider fallback returns null for estimateCost');
  } else {
    fail(`Unknown model fallback failed: expected null, got ${unknownCost}`);
  }

  // 6. formatBreakdown renders "est. cost n/a" (not $0.0000) when cost is null
  const accNull = new TokenAccumulator();
  accNull.record('evaluation', { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 });
  const breakdownNull = formatBreakdown(accNull, 'completely-unknown-model-xyz', 'unknown-provider');
  if (breakdownNull.includes('est. cost n/a') && !breakdownNull.includes('$0.0000')) {
    pass('formatBreakdown renders "est. cost n/a" (not $0.0000) when cost is null');
  } else {
    fail(`formatBreakdown null cost rendering failed:\n${breakdownNull}`);
  }

  // 7. formatBreakdown renders a zero-token step as "(zero-token by design)"
  const accZero = new TokenAccumulator();
  accZero.recordZeroToken('scan');
  accZero.record('evaluation', { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 });
  const breakdownZero = formatBreakdown(accZero, 'gpt-4o-mini', 'openai');
  if (breakdownZero.includes('(zero-token by design)')) {
    pass('formatBreakdown renders zero-token step as "(zero-token by design)"');
  } else {
    fail(`formatBreakdown zero-token step rendering failed:\n${breakdownZero}`);
  }
} catch (e) {
  fail(`token-tracker tests crashed: ${e.message}`);
}
