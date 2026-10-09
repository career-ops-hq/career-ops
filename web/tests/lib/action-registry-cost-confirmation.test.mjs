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
  assert.match(result.summary, /3 tarefas/);
  assert.match(result.summary, /≈ 36k tokens/);
  assert.match(result.summary, /≈ \$0\.36/);

  const confirmed = result.run();
  assert.equal(started.length, 3);
  assert.equal(confirmed.jobIds.length, 3);
  assert.ok(confirmed.batchId);
});

test("confirmed portal targeting waits for the saved configuration before starting the requested free search", async () => {
  const { ctx } = context([]);
  const writes = [];
  const searches = [];
  const pushes = [];
  let finishWrite;
  ctx.writePortals = (roles, location) => {
    writes.push({ roles, location });
    return new Promise((resolve) => { finishWrite = resolve; });
  };
  ctx.applyExplore = (patch, options) => searches.push({ patch, options });
  ctx.push = (path) => pushes.push(path);

  const result = dispatch("setPortals", {
    roles: ["Assistente de Vendas"],
    location: ["Lisboa"],
    run: true,
  }, ctx);

  assert.equal(result.status, "confirm");
  assert.equal(writes.length, 0);
  assert.equal(searches.length, 0);

  result.run();
  assert.deepEqual(writes, [{ roles: ["Assistente de Vendas"], location: ["Lisboa"] }]);
  assert.deepEqual(searches, [], "the search must not outrun the portals.yml write");
  assert.deepEqual(pushes, []);

  finishWrite();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(searches, [{
    patch: { positive: ["Assistente de Vendas"], allow: ["Lisboa"] },
    options: { run: true },
  }]);
  assert.deepEqual(pushes, ["/explore"]);
});

test("a failed portal write never starts the requested search", async () => {
  const { ctx } = context([]);
  const searches = [];
  const pushes = [];
  ctx.writePortals = async () => { throw new Error("write failed"); };
  ctx.applyExplore = (patch, options) => searches.push({ patch, options });
  ctx.push = (path) => pushes.push(path);

  const result = dispatch("setPortals", { roles: ["Assistente de Vendas"], run: true }, ctx);
  assert.equal(result.status, "confirm");

  result.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(searches, []);
  assert.deepEqual(pushes, []);
});
