// The one guarantee this system makes that a candidate cannot check for
// themselves: legal, visa, work-authorization, salary and demographic questions
// are never auto-answered.
//
// Before this module, that guarantee was a single bullet in the planner prompt
// plus a needs_confirmation flag on the reply. Both are the planner agreeing to
// refuse. A planner that instead returns a fluent, confident, entirely invented
// sentence about the candidate's immigration status sets needs_confirmation
// false, and the value was used: typed into a real employer's form, or stored
// on the report and re-read before the next application.
//
// So the assertions here are about a value never reaching a field at all. They
// are deliberately lopsided: the false-positive cases cost one answer the
// candidate types themselves, the false-negative case is a fabricated visa
// answer sent to an employer.
//
// Run:  node --test tests/lib/sensitive-questions.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveQuestion, sensitiveCategory, SENSITIVE_PATTERNS } from "../../src/lib/apply/sensitive-questions.mjs";

/** Real phrasings, taken from the shapes application forms actually use. */
const MUST_REFUSE = [
  ["visa", "Will you now or in the future require sponsorship for employment visa status?"],
  ["visa", "Are you a citizen of the United Kingdom?"],
  ["visa", "Do you hold a green card?"],
  ["visa", "What is your nationality?"],
  ["work-authorization", "Are you legally authorized to work in the United States?"],
  ["work-authorization", "Do you have the right to work in Germany?"],
  ["work-authorization", "Please confirm your eligibility to work in this location."],
  ["work-authorization", "Employment authorisation status?"],
  ["salary", "What are your salary expectations for this role?"],
  ["salary", "Desired compensation"],
  ["salary", "What is your current pay?"],
  ["salary", "Expected hourly rate"],
  ["demographic", "What is your gender?"],
  ["demographic", "Do you identify as a protected veteran?"],
  ["demographic", "Please self-identify your race and ethnicity."],
  ["demographic", "Do you have a disability?"],
  ["demographic", "What is your date of birth?"],
  ["demographic", "Do you require a reasonable accommodation?"],
  ["legal", "Have you ever been convicted of a felony?"],
  ["legal", "Are you willing to undergo a background check?"],
  ["legal", "Do you hold an active security clearance?"],
  ["legal", "Are you bound by a non-compete agreement?"],
  ["consent", "I agree to the privacy policy and terms of service."],
  ["consent", "I consent to the processing of my data under GDPR."],
  // A bare "Terms *" checkbox, which the apply flow's original consent regex
  // caught with a bare `terms`. This category has to stay a superset of it.
  ["consent", "Terms *"],
];

/** Ordinary free-text questions. Answering these is the whole point. */
const MUST_ALLOW = [
  "Describe a workflow you have meaningfully changed using AI. Under 150 words.",
  "Why do you want to work here?",
  "What is the most impactful thing you have built?",
  "Tell us about a time you disagreed with a decision and what you did.",
  "How do you approach code review on a team of eight?",
  "What would your first 90 days look like?",
  // "in terms of" is ordinary English and must not be read as a consent label,
  // even though the consent category has to keep the bare word "terms" to cover
  // a checkbox labelled only "Terms *".
  "In terms of impact, what are you proudest of?",
  "How do you think about trade-offs in terms of cost and speed?",
];

test("every question a form uses to ask something protected is refused", () => {
  for (const [category, question] of MUST_REFUSE) {
    assert.equal(
      sensitiveCategory(question),
      category,
      `must be refused as ${category}: ${question}`,
    );
  }
});

test("ordinary free-text questions are still draftable", () => {
  for (const question of MUST_ALLOW) {
    assert.equal(sensitiveCategory(question), null, `must stay draftable: ${question}`);
  }
});

test("matching ignores case and punctuation around the phrase", () => {
  assert.ok(isSensitiveQuestion("SALARY EXPECTATIONS?"));
  assert.ok(isSensitiveQuestion("...visa sponsorship required?"));
  assert.ok(isSensitiveQuestion("Your age?"));
});

test("a whole word is required, so an innocent substring is not a refusal", () => {
  // The cost of getting this wrong is not symmetric with a miss, but a predicate
  // that fires on any question containing "sex" inside "sexagenarian" or "nda"
  // inside "agenda" would refuse most of the form and teach the user to ignore
  // the label.
  assert.equal(sensitiveCategory("What is on the agenda for your first week?"), null);
  assert.equal(sensitiveCategory("Describe how you manage a large backlog."), null);
  assert.equal(sensitiveCategory("How do you leverage telemetry?"), null);
});

test("no pattern carries the g flag", () => {
  // A `g` regex keeps `lastIndex` between .test() calls. Shared at module scope,
  // that makes the guard match every OTHER question - silently, intermittently,
  // and only in the direction that lets a sensitive question through.
  for (const { category, pattern } of SENSITIVE_PATTERNS) {
    assert.equal(pattern.global, false, `${category} pattern must not be global`);
  }
});

test("the predicate is stable across repeated calls on the same question", () => {
  // The regression the test above guards against, stated as behaviour.
  const q = "Will you now or in the future require visa sponsorship?";
  for (let i = 0; i < 5; i += 1) assert.equal(isSensitiveQuestion(q), true, `call ${i + 1}`);
});

test("empty and non-string input is not sensitive, and does not throw", () => {
  for (const bad of ["", "   ", null, undefined, 42, {}, []]) {
    assert.equal(sensitiveCategory(bad), null, `${JSON.stringify(bad)} must be null`);
  }
});
