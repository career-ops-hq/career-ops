// extractJsonObject salvages the largest valid prefix of a truncated LLM
// answer (apply/prefill/route.ts). Factored into its own .mjs specifically so
// it can be exercised directly here — no @/ alias, no Node-only deps.
//
// Covers the bug: the truncation-salvage path used to compute the closing
// "pad" ONCE from the whole (broken) fragment's brace count, then reuse that
// same pad for every backtracked candidate. An earlier field almost never
// needs the same nesting depth as the full truncated tail, so the pad was
// wrong for every candidate except by coincidence — the loop exhausted every
// comma and returned null, discarding every field that DID finish along with
// the one that didn't.
//
// Run:  node --test tests/lib/extract-json-object.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "../../src/lib/extract-json-object.mjs";

test("a complete, well-formed object parses normally (not the truncation path)", () => {
  const { obj, truncated } = extractJsonObject('{"a": {"value": "x", "needs_confirmation": false}}');
  assert.deepEqual(obj, { a: { value: "x", needs_confirmation: false } });
  assert.equal(truncated, false);
});

test("strips code fences before locating the object", () => {
  const { obj } = extractJsonObject('```json\n{"a": {"value": "x"}}\n```');
  assert.deepEqual(obj, { a: { value: "x" } });
});

test("the reported bug: an earlier COMPLETE field must survive a later field truncated at a DEEPER nesting level", () => {
  // "name" is fully closed. "about_you" is a free-text field whose value text
  // happens to mention brace-heavy content (config examples, code) and gets
  // killed mid-string at a deeper nesting level than "name" ever reached.
  const truncated =
    '{"name": {"value": "Jane Doe", "needs_confirmation": false}, ' +
    '"about_you": {"value": "I build systems using patterns like {config: {nested: true';
  const { obj, truncated: wasTruncated } = extractJsonObject(truncated);
  assert.notEqual(obj, null, "the complete earlier field must not be lost just because a later field was cut deeper");
  assert.deepEqual(obj, { name: { value: "Jane Doe", needs_confirmation: false } });
  assert.equal(wasTruncated, true);
});

test("truncation mid-way through a single field's value: the field itself is unrecoverable, returns null", () => {
  const { obj, truncated } = extractJsonObject('{"a": {"value": "x');
  assert.equal(obj, null);
  assert.equal(truncated, true);
});

test("multiple recoverable fields at different nesting depths all survive", () => {
  const truncated =
    '{"a": {"value": "x", "needs_confirmation": false}, ' +
    '"b": {"value": "y"}, ' +
    '"c": {"value": {"deep": {"deeper": "z"}}}, ' +
    '"d": {"value": "cut off mid';
  const { obj, truncated: wasTruncated } = extractJsonObject(truncated);
  assert.deepEqual(obj, {
    a: { value: "x", needs_confirmation: false },
    b: { value: "y" },
    c: { value: { deep: { deeper: "z" } } },
  });
  assert.equal(wasTruncated, true);
});

test("no opening brace at all returns null, not truncated", () => {
  const { obj, truncated } = extractJsonObject("just some prose, no JSON here");
  assert.equal(obj, null);
  assert.equal(truncated, false);
});

test("an unbalanced fragment with nothing recoverable before the first field returns null cleanly", () => {
  const { obj, truncated } = extractJsonObject('{"a": {"b"');
  assert.equal(obj, null);
  assert.equal(truncated, true);
});

test("recovery still works when substantial prose precedes the opening brace", () => {
  // `start` (an offset into the FULL string) used to be compared directly
  // against a frag-relative backtrack index. With enough leading prose that
  // start alone exceeds the JSON fragment's own length, every frag-relative
  // comma satisfied that comparison trivially, so backtracking gave up on its
  // first attempt even though a valid earlier candidate existed.
  const longProse = "x".repeat(200) + " Here is the answer:\n\n";
  const truncated =
    longProse +
    '{"name": {"value": "Jane Doe", "needs_confirmation": false}, "about_you": {"value": "cut off mid';
  const { obj, truncated: wasTruncated } = extractJsonObject(truncated);
  assert.notEqual(obj, null, "leading prose must not defeat recovery of an otherwise-valid earlier field");
  assert.deepEqual(obj, { name: { value: "Jane Doe", needs_confirmation: false } });
  assert.equal(wasTruncated, true);
});

test("a completed field's own string value may contain a literal unmatched brace", () => {
  // A free-text answer that mentions code/config syntax is exactly the kind
  // of content real LLM output contains. The literal '{' inside the STRING
  // must not be counted as a structural brace when computing the pad, or an
  // otherwise complete, valid field becomes unparseable.
  const truncated =
    '{"about_you": {"value": "I use patterns like {config here", "needs_confirmation": false}, ' +
    '"other": {"value": "cut off mid';
  const { obj, truncated: wasTruncated } = extractJsonObject(truncated);
  assert.notEqual(obj, null, "a literal brace inside a completed field's string value must not block recovery");
  assert.deepEqual(obj, { about_you: { value: "I use patterns like {config here", needs_confirmation: false } });
  assert.equal(wasTruncated, true);
});

test("an incomplete trailing field must be OMITTED, never fabricated from a partial nested value", () => {
  // "b"'s own value object only has "value" so far — "needs_confirmation"
  // never arrived. A backtrack point INSIDE "b" (the comma between its two
  // properties) is not a field boundary; accepting it would close "b" early
  // and hand back {"value": "x"} as if that were the planner's complete
  // answer, when it silently dropped content mid-field. The caller has no
  // way to distinguish that from a genuinely short but complete answer, so
  // omitting the field entirely is the only safe outcome.
  const { obj, truncated } = extractJsonObject('{"a":1,"b":{"value":"x","needs_confirmation":');
  assert.deepEqual(obj, { a: 1 }, "the incomplete 'b' field must not appear at all, fabricated or otherwise");
  assert.equal(truncated, true);
});
