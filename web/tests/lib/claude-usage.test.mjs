import assert from "node:assert/strict";
import test from "node:test";

import { claudeUsageTokens } from "../../src/lib/claude-usage.mjs";

test("counts every Claude usage category, including cache reads", () => {
  assert.equal(
    claudeUsageTokens({
      input_tokens: 11,
      output_tokens: 7,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 101,
    }),
    124,
  );
});

test("treats absent and malformed counters as zero", () => {
  assert.equal(claudeUsageTokens(undefined), 0);
  assert.equal(
    claudeUsageTokens({
      input_tokens: 3,
      output_tokens: Number.NaN,
      cache_creation_input_tokens: 1.5,
      cache_read_input_tokens: -2,
    }),
    3,
  );
});
