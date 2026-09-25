// toAnswers is the boundary where a language model's output becomes something a
// form-filler will put in front of an employer. Everything upstream of it is
// untrusted: extractJsonObject recovers what it can, including from a truncated
// answer, so a field can arrive as a bare string, a number, null, an array, or
// an object missing the keys the prompt asked for.
//
// The assertion that carries the weight is `needs_confirmation === true`,
// strictly. The planner sets that flag on the categories it is told never to
// fill (legal, visa, work authorization, salary, demographic). A looser test
// turns a refusal into a confirmation, and the failure is silent: a fabricated
// visa or salary answer looks exactly like a real one until it has been sent.
//
// Run:  node --test tests/lib/planner-answers.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnswers } from "../../src/lib/apply/planner-answers.mjs";

test("a well-formed answer passes through with both fields", () => {
  assert.deepEqual(toAnswers({ q0: { value: "Because of the platform work.", needs_confirmation: false } }), {
    q0: { value: "Because of the platform work.", needs_confirmation: false },
  });
});

test("needs_confirmation is true ONLY for a literal true", () => {
  // Everything here is a refusal the model expressed sloppily, or no refusal at
  // all. Only the first may come back as a refusal; the rest must not silently
  // become one either, but crucially none of the falsy spellings may be read as
  // a confirmation of a sensitive field.
  assert.equal(toAnswers({ a: { value: "", needs_confirmation: true } }).a.needs_confirmation, true);
  for (const sloppy of ["true", 1, {}, [], "yes"]) {
    assert.equal(
      toAnswers({ a: { value: "", needs_confirmation: sloppy } }).a.needs_confirmation,
      false,
      `needs_confirmation: ${JSON.stringify(sloppy)} must not be read as a refusal flag`,
    );
  }
});

test("a missing needs_confirmation defaults to false, never undefined", () => {
  const out = toAnswers({ a: { value: "x" } });
  assert.equal(out.a.needs_confirmation, false);
  assert.equal(typeof out.a.needs_confirmation, "boolean");
});

test("a non-string value becomes an empty string rather than leaking a number or null", () => {
  for (const bad of [42, null, undefined, { nested: true }, ["a"]]) {
    const out = toAnswers({ a: { value: bad, needs_confirmation: false } });
    assert.equal(out.a.value, "", `value: ${JSON.stringify(bad)} should not survive as-is`);
  }
});

test("entries that are not objects are dropped, not coerced into empty answers", () => {
  // A truncated recovery can leave a field as a bare string. Keeping it as
  // {value: ""} would count as an answered field downstream and suppress the
  // draft the user actually needs.
  const out = toAnswers({ good: { value: "ok" }, bare: "just a string", nul: null, num: 7, arr: [1, 2] });
  assert.deepEqual(Object.keys(out), ["good"]);
});

test("a non-object input returns an empty map instead of throwing", () => {
  for (const bad of [null, undefined, "text", 42, ["a"]]) {
    assert.deepEqual(toAnswers(bad), {}, `${JSON.stringify(bad)} should yield {}`);
  }
});

test("an empty object is empty, not a crash", () => {
  assert.deepEqual(toAnswers({}), {});
});
