// tests/token-tracker.test.mjs — token tracking & cost estimation unit tests
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { estimateCost, TokenAccumulator, formatBreakdown, formatK, RATES } from '../utils/token-tracker.mjs';
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

  // 5b. An OpenAI-compatible run with a model that has no rate is not priced
  // as gpt-4o-mini: a local server's model would otherwise show a cost.
  const localCost = estimateCost('local-model-example', usage, 'openai');
  const accLocal = new TokenAccumulator();
  accLocal.record('evaluation', { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 });
  const localBreakdown = formatBreakdown(accLocal, 'local-model-example', 'openai');
  if (localCost === null && localBreakdown.includes('est. cost n/a')) {
    pass('openai provider with an unknown model reports est. cost n/a');
  } else {
    fail(`openai unknown model should be n/a, got ${localCost}:\n${localBreakdown}`);
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

  // 8. MiniMax model rates include uncached input, cached input, and output
  const minimaxUsage = { prompt_tokens: 1000000, completion_tokens: 1000000, cached_tokens: 500000 };
  const minimaxCases = [
    ['MiniMax-M3.1-Flash', 0.6825],
    ['MiniMax-M3', 2.76],
    ['MiniMax-M2.7', 1.38],
  ];
  for (const [model, expected] of minimaxCases) {
    const actual = estimateCost(model, minimaxUsage, 'minimax');
    if (actual !== null && Math.abs(actual - expected) < 1e-9) {
      pass(`estimateCost for ${model} includes its cached-input rate`);
    } else {
      fail(`estimateCost for ${model} failed: expected ${expected}, got ${actual}`);
    }
  }

  // 9. formatK returns '12.4k' for 12400
  const formatted = formatK(12400);
  if (formatted === '12.4k') {
    pass('formatK(12400) returns "12.4k"');
  } else {
    fail(`formatK failed: expected "12.4k", got "${formatted}"`);
  }

  // 10. Current Claude models price cache reads at their own (0.1x-class) rate,
  //     not the generic 0.5x fallback, and resolve through provider prefixes and
  //     OpenRouter's dotted version spelling without landing on a shorter sibling.
  //     1M uncached + 1M cached input + 1M output:
  const claudeUsage = { prompt_tokens: 2000000, completion_tokens: 1000000, cached_tokens: 1000000 };
  const claudeCases = [
    ['claude-haiku-4-5', 'claude', 1 + 0.1 + 5],
    ['claude-sonnet-5', 'claude', 2 + 0.2 + 10],
    ['claude-opus-5', 'claude', 5 + 0.5 + 25],
    ['anthropic/claude-opus-5-5', 'openrouter', 4 + 0.2 + 20],
    ['anthropic/claude-sonnet-4.6', 'openrouter', 3 + 0.3 + 15],
    ['claude-some-future-model', 'claude', 2 + 0.1 + 10], // falls back to the standard tier (Sonnet 5.5)
    // The 5.5 tier models and Fable each resolve to their own row: Sonnet 5.5
    // is not Sonnet 5 (0.20 cache read), and Haiku 5.5 / Fable 5.2 do not fall
    // to the unknown-Claude fallback.
    ['claude-sonnet-5-5', 'claude', 2 + 0.1 + 10],
    ['claude-opus-5-5', 'claude', 4 + 0.2 + 20],
    ['claude-haiku-5-5', 'claude', 0.1 + 0.01 + 0.5],
    ['claude-fable-5-2', 'claude', 8 + 0.2 + 40],
    ['claude-fable-5-1', 'claude', 10 + 0.25 + 50],
    ['claude-fable-5', 'claude', 10 + 1 + 50],
    ['anthropic/claude-sonnet-5.5', 'openrouter', 2 + 0.1 + 10], // dotted spelling, not claude-sonnet-5
    ['anthropic/claude-fable-5.2', 'openrouter', 8 + 0.2 + 40], // dotted spelling, not claude-fable-5
    ['anthropic/claude-haiku-5-5', 'openrouter', 0.1 + 0.01 + 0.5],
  ];
  const prevModel = process.env.CAREER_OPS_MODEL;
  process.env.CAREER_OPS_MODEL = 'set'; // OpenRouter is only priced when a model is pinned
  for (const [model, provider, expected] of claudeCases) {
    const actual = estimateCost(model, claudeUsage, provider);
    if (actual !== null && Math.abs(actual - expected) < 1e-9) {
      pass(`estimateCost prices ${model} (${provider}) at current Claude rates`);
    } else {
      fail(`estimateCost for ${model} (${provider}) failed: expected ${expected}, got ${actual}`);
    }
  }
  if (prevModel === undefined) delete process.env.CAREER_OPS_MODEL; else process.env.CAREER_OPS_MODEL = prevModel;

  // 11. Every model batch/batch-runner.sh maps a spend_tier to has a row of its
  //     own under its exact id, so a tier change there that forgets this table
  //     fails here instead of pricing the new model as a sibling.
  const runner = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'batch', 'batch-runner.sh'), 'utf8');
  const tierBody = (runner.match(/spend_tier_to_model\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  const tierModels = [...tierBody.matchAll(/echo\s+"(claude-[a-z0-9-]+)"/g)].map((m) => m[1]);
  const unpriced = tierModels.filter((id) => !Object.hasOwn(RATES, id));
  if (tierModels.length >= 3 && unpriced.length === 0) {
    pass(`every spend_tier model in batch-runner.sh has its own rate row (${tierModels.join(', ')})`);
  } else {
    fail(`spend_tier models without their own rate row: ${unpriced.join(', ') || `(found only ${tierModels.length} tier models)`}`);
  }
} catch (e) {
  fail(`token-tracker tests crashed: ${e.message}`);
}
