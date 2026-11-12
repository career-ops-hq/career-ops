import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/web-ts-alias-loader.mjs";

const { dispatch } = await import("../../src/app/actions/registry.ts");

function context() {
  const started = [];
  const writes = [];
  return {
    started,
    writes,
    ctx: {
      push() {},
      replace() {},
      startJob(opts) {
        started.push(opts);
        return `job-${started.length}`;
      },
      inbox: [],
      applications: [{ n: "7", company: "Acme", role: "Engineer" }],
      jobForUrl() {},
      estimateCost() {
        return { tokens: 0, usd: 0 };
      },
      rememberFact() {},
      writeStatus(n, status) {
        writes.push([n, status]);
      },
      setApplyField() {},
      startApply() {},
    },
  };
}

test("generatePdf names the company for a zero-padded application number", () => {
  const { ctx, started } = context();
  dispatch("generatePdf", { n: "007" }, ctx);
  assert.equal(started[0].title, "CV PDF · Acme");
});

test("setStatus names the company and role for a zero-padded application number", async () => {
  const { ctx, writes } = context();
  const result = dispatch("setStatus", { n: "007", status: "Applied" }, ctx);
  assert.equal(result.summary, "Mark Acme · Engineer → Applied?");
  await result.run();
  assert.deepEqual(writes, [["007", "Applied"]]);
});

test("an unknown or non-numeric number falls back to the raw label", () => {
  const { ctx, started } = context();
  dispatch("generatePdf", { n: "99" }, ctx);
  dispatch("generatePdf", { n: "abc" }, ctx);
  dispatch("generatePdf", { n: "7abc" }, ctx);
  assert.deepEqual(started.map((s) => s.title), ["CV PDF · #99", "CV PDF · #abc", "CV PDF · #7abc"]);
});


test("setStatus keeps its approved target and waits for the write result", async () => {
  const { ctx } = context();
  let release;
  ctx.writeStatus = () => new Promise((resolve) => { release = resolve; });
  const result = dispatch("setStatus", { n: "007", status: "Rejected" }, ctx);
  assert.deepEqual(result.statusChange, { n: "007", status: "Rejected" });
  let completed = false;
  const pending = result.run().then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  release(); await pending;
  assert.equal(completed, true);
  ctx.writeStatus = async () => { throw new Error("write failed"); };
  await assert.rejects(dispatch("setStatus", { n: "007", status: "Rejected" }, ctx).run(), /write failed/);
});
