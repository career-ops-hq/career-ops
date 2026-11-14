// Greenhouse boolean questions are radios. A multi-select stays a select.
// The schema is a local fixture. This test does not call the Greenhouse API.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-greenhouse-yesno.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import "../helpers/web-ts-alias-loader.mjs";

const { fetchGreenhouseSchema } = await import("../../src/lib/apply/greenhouse.ts");

test("a Greenhouse yes/no question is a radio, and a multi-select stays a select", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    questions: [
      { label: "Will you require sponsorship? *", required: true, fields: [{ name: "question_1", type: "boolean", values: [{ label: "Yes" }, { label: "No" }] }] },
      { label: "Locations", required: true, fields: [{ name: "question_2", type: "multi_value_multi_select", values: [{ label: "Remote" }, { label: "Springfield" }] }] },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const schema = await fetchGreenhouseSchema("fixture-co", "100");
    const yesNo = schema?.get("question_1");
    const multi = schema?.get("question_2");
    assert.equal(yesNo?.type, "radio");
    assert.deepEqual(yesNo?.options, ["Yes", "No"]);
    assert.equal(multi?.type, "select");
    assert.notEqual(yesNo?.type, multi?.type);
  } finally {
    globalThis.fetch = original;
  }
});
