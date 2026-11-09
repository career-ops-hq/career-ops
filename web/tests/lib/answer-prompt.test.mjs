// buildAnswerPrompt is the instruction the read-only planner receives before it
// drafts an answer for every field on a real application form
// (apply/prefill/route.ts). Factored into its own .mjs for the same reason
// extract-json-object.mjs was: no @/ alias, no Node-only deps, so it can be
// exercised directly here. It spent its life inline in a ReadableStream's
// start(), which is why none of this was pinned.
//
// The assertion that carries weight is what the planner may answer. Work
// authorization, visa sponsorship, and compensation come from the profile when
// it states them, and stay blank when it does not. Citizenship, gender, race,
// disability, and veteran stay blank. Years of experience are not invented to
// clear a minimum. A prompt that quietly drops any of that still returns
// well-formed JSON. The rest of the file covers the shape the planner is told
// to read (the field table) and write (the JSON contract).
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

test("profile-backed screening is filled from the profile, and identity questions stay blank", () => {
  const prompt = buildAnswerPrompt({ title: "Acme - Staff Engineer", fields: FIELDS, profile: "config/profile.yml" });
  assert.match(prompt, /location\.authorized_in/);
  assert.match(prompt, /location\.visa_status/);
  assert.match(prompt, /location\.needs_sponsorship/);
  assert.match(prompt, /compensation\.target_range/);
  assert.match(prompt, /If config\/profile\.yml does not state that answer, set needs_confirmation:true and value:""/);
  assert.doesNotMatch(prompt, /NEVER fill[^\n]*\bvisa\b/);
  assert.doesNotMatch(prompt, /NEVER fill[^\n]*work-authorization/);
  assert.doesNotMatch(prompt, /NEVER fill[^\n]*\bsalary\b/);
  assert.match(prompt, /NEVER invent a work-authorization, visa, sponsorship, or salary answer/);
  for (const word of ["citizenship", "gender", "race", "disability", "veteran", "criminal history", "non-compete", "security clearance", "date of birth", "sexual orientation", "religion", "marital status"]) {
    assert.match(prompt, new RegExp(`NEVER fill[^\\n]*${word}`));
  }
  assert.match(prompt, /NEVER invent years of experience/);
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
