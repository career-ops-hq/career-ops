/**
 * utils/token-tracker.mjs — Token tracking and cost estimation for career-ops
 */

export const RATES = {
  // MiniMax models (legacy entries remain available for explicit model requests)
  'MiniMax-M3.1-Flash': { input: 0.15 / 1000000, output: 0.60 / 1000000, cachedInput: 0.015 / 1000000 },
  'MiniMax-M3': { input: 0.60 / 1000000, output: 2.40 / 1000000, cachedInput: 0.12 / 1000000 },
  'MiniMax-M2.7': { input: 0.30 / 1000000, output: 1.20 / 1000000, cachedInput: 0.06 / 1000000 },

  // OpenAI models
  'gpt-4o-mini': { input: 0.150 / 1000000, output: 0.600 / 1000000 },
  'gpt-4o': { input: 2.50 / 1000000, output: 10.00 / 1000000 },

  // Gemini models (Developer API paid tier, USD per token; free tier is $0)
  'gemini-3.6-flash': { input: 1.50 / 1000000, output: 7.50 / 1000000, cachedInput: 0.15 / 1000000 },
  'gemini-3.5-flash': { input: 1.50 / 1000000, output: 9.00 / 1000000, cachedInput: 0.15 / 1000000 },
  'gemini-2.5-flash': { input: 0.075 / 1000000, output: 0.300 / 1000000, cachedInput: 0.0375 / 1000000 },
  'gemini-2.5-pro': { input: 1.25 / 1000000, output: 5.00 / 1000000, cachedInput: 0.625 / 1000000 },

  // OpenRouter / DeepSeek models
  'deepseek/deepseek-chat': { input: 0.14 / 1000000, output: 0.28 / 1000000 },
  'deepseek-chat': { input: 0.14 / 1000000, output: 0.28 / 1000000 },
  'deepseek/deepseek-reasoner': { input: 0.55 / 1000000, output: 2.19 / 1000000 },
  'deepseek-reasoner': { input: 0.55 / 1000000, output: 2.19 / 1000000 },

  // Anthropic / Claude models. First-party list prices per 1M tokens from
  // https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-12).
  // Cache reads bill at a fraction of input (0.1x for most models; 0.05x on
  // Opus/Sonnet 5.5, 0.025x on Fable 5.2/5.1, per that page's footnotes), so
  // each row carries cachedInput: the 0.5x generic fallback below would
  // overstate a cache-heavy Claude run. Cache writes (5m: 1.25x input on every
  // row here, per the same page) are not modeled: estimateCost bills them as
  // plain input, as it does for every provider.
  // Longer ids come before their prefixes so substring matching
  // ("anthropic/claude-opus-5-5", "claude-sonnet-5.5") can't land on a
  // shorter sibling.
  // Fable 5.2: $8 in / $40 out / $0.20 cache read (page row).
  'claude-fable-5-2': { input: 8.00 / 1000000, output: 40.00 / 1000000, cachedInput: 0.20 / 1000000 },
  // Fable 5.1: $10 / $50 / $0.25 (page row); listed so it does not fall to Fable 5's $1 cache read.
  'claude-fable-5-1': { input: 10.00 / 1000000, output: 50.00 / 1000000, cachedInput: 0.25 / 1000000 },
  // Fable 5: $10 / $50 / $1 (page row, standard 0.1x).
  'claude-fable-5': { input: 10.00 / 1000000, output: 50.00 / 1000000, cachedInput: 1.00 / 1000000 },
  // Opus 5.5 (spend_tier premium in batch/batch-runner.sh): $4 / $20 / $0.20 (page row).
  'claude-opus-5-5': { input: 4.00 / 1000000, output: 20.00 / 1000000, cachedInput: 0.20 / 1000000 },
  'claude-opus-5': { input: 5.00 / 1000000, output: 25.00 / 1000000, cachedInput: 0.50 / 1000000 },
  'claude-opus-4-8': { input: 5.00 / 1000000, output: 25.00 / 1000000, cachedInput: 0.50 / 1000000 },
  'claude-opus-4-7': { input: 5.00 / 1000000, output: 25.00 / 1000000, cachedInput: 0.50 / 1000000 },
  'claude-opus-4-6': { input: 5.00 / 1000000, output: 25.00 / 1000000, cachedInput: 0.50 / 1000000 },
  // Sonnet 5.5 (spend_tier standard): $2 / $10 / $0.10 (page row).
  'claude-sonnet-5-5': { input: 2.00 / 1000000, output: 10.00 / 1000000, cachedInput: 0.10 / 1000000 },
  'claude-sonnet-5': { input: 2.00 / 1000000, output: 10.00 / 1000000, cachedInput: 0.20 / 1000000 },
  'claude-sonnet-4-6': { input: 3.00 / 1000000, output: 15.00 / 1000000, cachedInput: 0.30 / 1000000 },
  // Haiku 5.5 (spend_tier economy): $0.10 / $0.50 / $0.01 cache read (page row
  // for prompts up to 100K tokens; 0.01 is the standard 0.1x). Requests over
  // 100K bill $0.50 / $2.50 / $0.05; usage here is a run total, so it cannot
  // tell which requests crossed the line and uses the lower row.
  'claude-haiku-5-5': { input: 0.10 / 1000000, output: 0.50 / 1000000, cachedInput: 0.01 / 1000000 },
  'claude-haiku-4-5': { input: 1.00 / 1000000, output: 5.00 / 1000000, cachedInput: 0.10 / 1000000 },
  'claude-3-5-sonnet': { input: 3.0 / 1000000, output: 15.0 / 1000000 },
  'claude-3-5-haiku': { input: 0.80 / 1000000, output: 4.00 / 1000000 },
  'claude-3-opus': { input: 15.00 / 1000000, output: 75.00 / 1000000 },
  'claude-3-haiku': { input: 0.25 / 1000000, output: 1.25 / 1000000 },
};

/**
 * Normalize an OpenAI-compatible usage object, applying safe defaults.
 *
 * Four evaluator call sites previously duplicated this exact extraction.
 * Centralising it here keeps the fallback order (prompt_tokens_details →
 * cached_tokens → 0) in one authoritative place.
 *
 * @param {object|null|undefined} usage - Raw `data.usage` from the API response.
 * @returns {{ prompt_tokens: number, completion_tokens: number, total_tokens: number, cached_tokens: number }}
 */
export function normalizeOpenAIUsage(usage) {
  return {
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? 0
  };
}

export function estimateCost(model, usage, provider) {
  if (provider === 'ollama') return 0;
  if (provider === 'openrouter' && !process.env.CAREER_OPS_MODEL) {
    // OpenRouter free rotation models are free
    return 0;
  }

  let rate = null;
  if (model) {
    rate = RATES[model];
    if (!rate) {
      // try matching prefix or substring
      // OpenRouter spells Claude versions with dots ("anthropic/claude-sonnet-4.6"),
      // the rate table with hyphens. Claude keys also match that spelling with
      // dots turned to hyphens, in the same pass and table order, so
      // "claude-sonnet-5.5" reaches its own row before "claude-sonnet-5"
      // (a verbatim-first pass would stop at the shorter key). Other keys,
      // such as the dotted Gemini ones, keep matching verbatim.
      const dashed = model.replace(/\./g, '-');
      const key = Object.keys(RATES).find(k => model.includes(k)
        || (k.startsWith('claude-') && dashed.includes(k)));
      if (key) {
        rate = RATES[key];
      }
    }
  }

  if (!rate) {
    // No 'openai' fallback: openai-eval also talks to local OpenAI-compatible
    // servers, and pricing an unknown model at gpt-4o-mini's rate would show a
    // cost for a model that charges nothing. Unknown means "est. cost n/a".
    if (provider === 'gemini') {
      rate = RATES['gemini-3.6-flash'];
    } else if (provider === 'claude' || provider === 'anthropic') {
      // Unknown Claude id: price it as the standard spend_tier model
      // (batch/batch-runner.sh spend_tier_to_model: standard → claude-sonnet-5-5).
      rate = RATES['claude-sonnet-5-5'];
    } else {
      return null;
    }
  }

  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cached = usage.cached_tokens || 0;
  const promptCost = Math.max(promptTokens - cached, 0) * rate.input;
  const cachedCost = cached * (rate.cachedInput ?? (rate.input * 0.5));
  const completionCost = completionTokens * rate.output;
  return promptCost + cachedCost + completionCost;
}

export class TokenAccumulator {
  constructor() {
    this.steps = {};
  }

  record(stepName, usage) {
    if (!this.steps[stepName]) {
      this.steps[stepName] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0, isZeroToken: false };
    }
    if (usage === 0 || usage === null || usage === undefined) {
      const step = this.steps[stepName];
      const hasRealUsage = step.prompt_tokens > 0 || step.completion_tokens > 0 || step.total_tokens > 0 || step.cached_tokens > 0;
      if (!hasRealUsage) {
        step.isZeroToken = true;
      }
    } else {
      this.steps[stepName].isZeroToken = false;
      this.steps[stepName].prompt_tokens += usage.prompt_tokens || 0;
      this.steps[stepName].completion_tokens += usage.completion_tokens || 0;
      this.steps[stepName].total_tokens += usage.total_tokens || 0;
      this.steps[stepName].cached_tokens += usage.cached_tokens || 0;
    }
  }

  recordZeroToken(stepName) {
    this.record(stepName, null);
  }

  getTotals() {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    let cached = 0;
    for (const step of Object.values(this.steps)) {
      if (!step.isZeroToken) {
        prompt += step.prompt_tokens;
        completion += step.completion_tokens;
        total += step.total_tokens;
        cached += step.cached_tokens;
      }
    }
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, cached_tokens: cached };
  }
}

export function formatK(tokens) {
  return (tokens / 1000).toFixed(1) + 'k';
}

export function formatBreakdown(accumulator, model, provider) {
  const lines = [];
  lines.push('Token breakdown:');
  
  const steps = ['scan', 'evaluation', 'pdf payload'];
  // Ensure any other recorded steps are printed too
  for (const key of Object.keys(accumulator.steps)) {
    if (!steps.includes(key)) {
      steps.push(key);
    }
  }

  for (const step of steps) {
    const data = accumulator.steps[step] || { isZeroToken: true };
    const label = (step + ':').padEnd(15);
    
    if (data.isZeroToken) {
      lines.push(`  ${label}(zero-token by design)`);
    } else {
      const pK = formatK(data.prompt_tokens);
      const cK = formatK(data.completion_tokens);
      let line = `  ${label}${pK} prompt / ${cK} completion`;
      if (data.cached_tokens > 0) {
        line += ` (cached: ${formatK(data.cached_tokens)})`;
      }
      lines.push(line);
    }
  }

  const totals = accumulator.getTotals();
  const cost = estimateCost(model, totals, provider);
  const totalK = formatK(totals.total_tokens);
  const labelTotal = 'total:'.padEnd(15);
  const costStr = cost === null ? 'est. cost n/a' : `$${cost.toFixed(4)}`;
  lines.push(`  ${labelTotal}${totalK} tokens (${costStr})`);
  lines.push(`  (metadata: model=${model}, provider=${provider})`);
  return lines.join('\n');
}
