/**
 * utils/token-tracker.mjs — Token tracking and cost estimation for career-ops
 */

export const RATES = {
  // OpenAI models
  'gpt-4o-mini': { input: 0.150 / 1000000, output: 0.600 / 1000000 },
  'gpt-4o': { input: 2.50 / 1000000, output: 10.00 / 1000000 },

  // Gemini models
  'gemini-2.5-flash': { input: 0.075 / 1000000, output: 0.300 / 1000000, cachedInput: 0.0375 / 1000000 },
  'gemini-2.5-pro': { input: 1.25 / 1000000, output: 5.00 / 1000000, cachedInput: 0.625 / 1000000 },

  // OpenRouter / DeepSeek models
  'deepseek/deepseek-chat': { input: 0.14 / 1000000, output: 0.28 / 1000000 },
  'deepseek-chat': { input: 0.14 / 1000000, output: 0.28 / 1000000 },
  'deepseek/deepseek-reasoner': { input: 0.55 / 1000000, output: 2.19 / 1000000 },
  'deepseek-reasoner': { input: 0.55 / 1000000, output: 2.19 / 1000000 },

  // Anthropic / Claude models
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
      const key = Object.keys(RATES).find(k => model.includes(k));
      if (key) {
        rate = RATES[key];
      }
    }
  }

  if (!rate) {
    if (provider === 'openai') {
      rate = RATES['gpt-4o-mini'];
    } else if (provider === 'gemini') {
      rate = RATES['gemini-2.5-flash'];
    } else if (provider === 'claude' || provider === 'anthropic') {
      rate = RATES['claude-3-5-sonnet'];
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

function formatK(tokens) {
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
    
    if (data.isZeroToken || (!data.prompt_tokens && !data.completion_tokens)) {
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
