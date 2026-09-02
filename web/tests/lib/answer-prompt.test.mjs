// buildAnswerPrompt is the instruction the read-only planner receives before it
// drafts an answer for every field on a real application form
// (apply/prefill/route.ts). Factored into its own .mjs for the same reason
// extract-json-object.mjs was: no @/ alias, no Node-only deps, so it can be
// exercised directly here. It spent its life inline in a ReadableStream's
// start(), which is why none of this was pinned.
//
// The assertion that carries weight is the sensitive-field carve-out. That one
// line is the only thing standing between an automated form-filler and a
// fabricated answer to a visa, salary or demographic question, and it fails
// silently: a prompt that quietly loses it still returns well-formed JSON, still
// renders in the UI, and is wrong in a way the candidate discovers after they
// have already submitted. The rest of the file covers the shape the planner is
// told to read (the field table) and write (the JSON contract), since a drift
// there means every answer comes back unusable.
//
// Run:  node --test tests/lib/answer-prompt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnswerPrompt } from "../../src/lib/apply/answer-prompt.mjs";

const FIELDS = [
  { id: "f1", type: "text", label: "Full name", required: true },
  { id: "f2", type: "textarea", label: "Why us?", required: false },
  { id: "f3", type: "select", label: "Work authorization", required: true, options: ["Yes", "No"] },
];

test("the sensitive-field carve-out survives, naming every category it protects", () => {
  const prompt = buildAnswerPrompt({ title: "Acme - Staff Engineer", fields: FIELDS });
  for (const category of ["legal", "visa", "work-authorization", "salary", "demographic"]) {
    assert.ok(
      prompt.includes(category),
      `the planner must be told never to fill ${category} fields; that instruction is gone`,
    );
  }
  assert.match(prompt, /NEVER fill[^\n]*needs_confirmation:true and value:""/);
});

test("the output contract the route parses back is stated in the prompt", () => {
  const prompt = buildAnswerPrompt({ title: "Acme", fields: FIELDS });
  // extractJsonObject reads exactly this shape out of the planner's answer.
  assert.match(prompt, /\{"value": "\.\.\.", "needs_confirmation": boolean\}/);
  assert.match(prompt, /No prose, no markdown, no code fence\./);
});

test("each field becomes one tab-separated row, required marked with an asterisk", () => {
  const prompt = buildAnswerPrompt({ title: "Acme", fields: FIELDS });
  assert.ok(prompt.includes("f1\ttext*\tFull name"), "a required field is starred");
  assert.ok(prompt.includes("f2\ttextarea\tWhy us?"), "an optional field is not starred");
});

test("options are appended only for the fields that have them", () => {
  const prompt = buildAnswerPrompt({ title: "Acme", fields: FIELDS });
  assert.ok(prompt.includes("f3\tselect*\tWork authorization\t[options: Yes | No]"));
  // A field without options must not grow an empty bracket the model then tries
  // to choose from.
  assert.ok(!prompt.includes("[options: ]"));
});

test("the role title reaches the prompt, so the planner is not drafting blind", () => {
  assert.ok(buildAnswerPrompt({ title: "Acme - Staff Engineer", fields: FIELDS }).includes("Acme - Staff Engineer"));
});

test("durable notes appear under their own heading when present, and not at all when empty", () => {
  const withMemory = buildAnswerPrompt({ title: "Acme", fields: FIELDS, memory: "Prefers remote." });
  assert.match(withMemory, /Durable notes about the user:\nPrefers remote\./);

  // Both spellings of "no memory", since the route passes readMemory().trim().
  for (const empty of [undefined, ""]) {
    const without = buildAnswerPrompt({ title: "Acme", fields: FIELDS, memory: empty });
    assert.ok(!without.includes("Durable notes about the user"), `memory=${JSON.stringify(empty)} left the heading behind`);
  }
});

test("a form with no fields still produces a well-formed prompt", () => {
  // openSession can hand back an empty field list; the planner should receive an
  // empty table rather than the string "undefined".
  const prompt = buildAnswerPrompt({ title: "Acme", fields: [] });
  assert.ok(!prompt.includes("undefined"));
  // The empty field list collapses to a blank line, which is what the template
  // has always produced here. Pinned as-is rather than tidied: this PR moves the
  // prompt, it does not reword it.
  assert.match(prompt, /FIELDS \(id ⇥ type ⇥ label ⇥ options\):\n\n\nFor each field/);
});
