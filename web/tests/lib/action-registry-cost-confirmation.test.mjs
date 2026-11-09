import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/web-ts-alias-loader.mjs";

const { dispatch } = await import("../../src/app/actions/registry.ts");

function context(inbox) {
  const started = [];
  return {
    started,
    ctx: {
      push() {},
      replace() {},
      startJob(opts) {
        started.push(opts);
        return `job-${started.length}`;
      },
      inbox,
      applications: [],
      jobForUrl() {},
      estimateCost(_kind, count) {
        return { tokens: count * 12_000, usd: count * 0.12 };
      },
      rememberFact() {},
      writeStatus() {},
      setApplyField() {},
      startApply() {},
    },
  };
}

const posting = (n) => ({ company: "Acme", role: `Engineer ${n}`, url: `https://example.test/${n}`, done: false });

test("one requested evaluation starts directly", () => {
  const { ctx, started } = context([posting(1)]);
  const result = dispatch("evaluateCompany", { company: "Acme" }, ctx);

  assert.equal(result.status, "done");
  assert.equal(started.length, 1);
});

test("multiple paid workers wait for confirmation and show estimated spend", () => {
  const { ctx, started } = context([posting(1), posting(2), posting(3)]);
  const result = dispatch("evaluateCompany", { company: "Acme" }, ctx);

  assert.equal(result.status, "confirm");
  assert.equal(started.length, 0, "no paid worker starts before confirmation");
  assert.match(result.summary, /3 workers/);
  assert.match(result.summary, /≈ 36k tokens/);
  assert.match(result.summary, /≈ \$0\.36/);

  const confirmed = result.run();
  assert.equal(started.length, 3);
  assert.equal(confirmed.jobIds.length, 3);
  assert.ok(confirmed.batchId);
});
