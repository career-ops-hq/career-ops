import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateRunCost,
  formatBatchSpendConfirmation,
  formatRunCostEstimate,
  formatTokenCount,
  requiresBatchSpendConfirmation,
} from "../../src/lib/run-cost-estimate.mjs";

const job = (tokens, { usd, startedAt = 1, kind = "evaluate", status = "done" } = {}) => ({
  kind,
  status,
  startedAt,
  cost: { tokens, ...(usd === undefined ? {} : { usd }) },
});

test("estimates a batch from the median of matching completed runs", () => {
  const jobs = [
    job(10_000, { usd: 0.1, startedAt: 3 }),
    job(12_000, { usd: 0.12, startedAt: 2 }),
    job(200_000, { usd: 2, startedAt: 1 }),
    job(5_000, { kind: "pdf" }),
    job(8_000, { status: "error" }),
  ];

  assert.deepEqual(estimateRunCost(jobs, "evaluate", 3), {
    tokens: 36_000,
    usd: 0.36,
    samples: 3,
  });
});

test("uses only the ten most recent matching samples", () => {
  const recent = Array.from({ length: 10 }, (_, i) => job(10_000, { startedAt: 20 - i }));
  assert.deepEqual(estimateRunCost([...recent, job(900_000, { startedAt: 1 })], "evaluate", 2), {
    tokens: 20_000,
    samples: 10,
  });
});

test("returns no estimate without valid local history", () => {
  assert.deepEqual(estimateRunCost([], "evaluate", 4), {});
  assert.deepEqual(estimateRunCost([job(Number.NaN), job(-5)], "evaluate", 4), {});
});

test("formats token and optional dollar estimates for pre-run copy", () => {
  assert.equal(formatTokenCount(950), "950");
  assert.equal(formatTokenCount(12_400), "12k");
  assert.equal(formatTokenCount(1_250_000), "1.3M");
  assert.equal(formatRunCostEstimate({ tokens: 36_000, usd: 0.36 }), "≈ 36k tokens · ≈ $0.36");
  assert.equal(formatRunCostEstimate({}), "uses your tokens");
});

test("requires confirmation whenever an action fans out into multiple paid workers", () => {
  assert.equal(requiresBatchSpendConfirmation(1), false);
  assert.equal(requiresBatchSpendConfirmation(2), true);
  assert.equal(requiresBatchSpendConfirmation(20), true);
});

test("batch confirmation names worker count and the local estimate", () => {
  assert.equal(
    formatBatchSpendConfirmation("Evaluate 3 Acme postings", 3, { tokens: 36_000, usd: 0.36 }),
    "Evaluate 3 Acme postings? (3 workers · ≈ 36k tokens · ≈ $0.36)",
  );
  assert.match(formatBatchSpendConfirmation("Evaluate 2 Acme postings", 2, {}), /estimate available after/);
});
