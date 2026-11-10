import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/web-ts-alias-loader.mjs";

const { dispatch } = await import("../../src/app/actions/registry.ts");

// remember writes into modes/_profile.md, which every mode reads as the
// user's own words. Model text there needs the user's yes first.
function context() {
  const remembered = [];
  return {
    remembered,
    ctx: {
      push() {},
      replace() {},
      startJob() {
        return "job-1";
      },
      inbox: [],
      applications: [],
      jobForUrl() {},
      rememberFact(fact) {
        remembered.push(fact);
      },
      writeStatus() {},
      setApplyField() {},
      startApply() {},
    },
  };
}

test("remember asks the user before it writes anything", () => {
  const { ctx, remembered } = context();
  const result = dispatch("remember", { fact: "  Prefers remote-first teams  " }, ctx);

  assert.equal(result.status, "confirm");
  assert.equal(remembered.length, 0, "nothing is saved before the user confirms");
  assert.match(result.summary, /Prefers remote-first teams/, "the confirm card shows the exact text to save");
});

test("a confirmed remember saves the trimmed text once", () => {
  const { ctx, remembered } = context();
  const result = dispatch("remember", { fact: "  Prefers remote-first teams  " }, ctx);

  result.run();
  assert.deepEqual(remembered, ["Prefers remote-first teams"]);
});

test("the confirm card shows the text exactly as it will be saved", () => {
  const { ctx, remembered } = context();
  const result = dispatch("remember", { fact: `Prefers   remote-first\nteams ${"x".repeat(400)}` }, ctx);

  result.run();
  assert.equal(remembered[0].length, 300);
  assert.ok(remembered[0].startsWith("Prefers remote-first teams "));
  assert.ok(result.summary.includes(`"${remembered[0]}"`), "the card and the saved text differ");
});

test("remember with only whitespace is ignored and saves nothing", () => {
  const { ctx, remembered } = context();
  const result = dispatch("remember", { fact: "   " }, ctx);

  assert.equal(result.status, "ignored");
  assert.equal(remembered.length, 0);
});
