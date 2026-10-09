const MAX_SAMPLES = 10;

function positiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Estimate a future run from the user's own recent completed runs of that kind.
 * A median keeps one unusually large agent run from inflating every later warning.
 */
export function estimateRunCost(jobs, kind, count = 1) {
  const runCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const samples = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job?.kind === kind && job?.status === "done" && positiveFinite(job?.cost?.tokens))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, MAX_SAMPLES);

  const tokensPerRun = median(samples.map((job) => job.cost.tokens));
  const usdPerRun = median(samples.map((job) => job.cost.usd).filter(positiveFinite));

  if (tokensPerRun === undefined) return {};
  return {
    tokens: Math.round(tokensPerRun * runCount),
    ...(usdPerRun === undefined ? {} : { usd: Number((usdPerRun * runCount).toFixed(2)) }),
    samples: samples.length,
  };
}

export function formatTokenCount(tokens) {
  if (!positiveFinite(tokens)) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

export function formatRunCostEstimate(estimate, fallback = "usa os teus tokens") {
  if (!positiveFinite(estimate?.tokens)) return fallback;
  const usd = positiveFinite(estimate?.usd) ? ` · ≈ $${estimate.usd.toFixed(2)}` : "";
  return `≈ ${formatTokenCount(estimate.tokens)} tokens${usd}`;
}

export function requiresBatchSpendConfirmation(count) {
  return Number.isFinite(count) && count > 1;
}

export function formatBatchSpendConfirmation(subject, count, estimate) {
  const workers = count === 1 ? "1 tarefa" : `${count} tarefas`;
  const cost = formatRunCostEstimate(estimate, "a estimativa fica disponível depois da primeira execução");
  return `${subject}? (${workers} · ${cost})`;
}
