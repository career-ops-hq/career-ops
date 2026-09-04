// Tests for the drive loop's submit guard: which controls the planner may be
// offered, and which it is refused when it asks.
//
// This is the one rule in the app that has no fallback ("Nothing is ever
// submitted automatically"), and it is decided on element facts read from a
// live page, so neither branch is observable from the drive loop itself. Both
// bypasses that motivated this module are pinned below: a control whose only
// name is an aria-label, and a control whose label is not in English.
//
// Run:  node --test tests/lib/submit-guard.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubmitControl, snapshotLabel, SUBMIT_RX } from "../../src/lib/apply/submit-guard.mjs";

/** The facts drive.ts reads, with the defaults of an ordinary in-form control. */
const el = (facts) => ({ tag: "button", type: "button", explicitType: true, inForm: true, ...facts });

test("isSubmitControl: an input that submits by type is refused", () => {
  // Given the plainest submit control there is
  const facts = el({ tag: "input", type: "submit", value: "Submit" });

  // When the guard reads it
  // Then it is refused on its type, before any label is considered
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: an icon-only button named only by aria-label is refused", () => {
  // Given a submit button carrying an icon, so its text is empty and its name
  // lives in aria-label — the string the planner is shown
  const facts = el({ aria: "Submit application", text: "" });

  // When the guard reads it
  // Then it is refused. Testing innerText here would have seen "" and clicked.
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a German submit label is refused", () => {
  // Given a scripted button (type=button, submitted by a handler) on a DACH portal
  const facts = el({ text: "Bewerbung absenden" });

  // When the guard reads it
  // Then the label alone is enough to refuse it
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a French submit label is refused", () => {
  // Given the same shape on a French portal
  const facts = el({ text: "Envoyer" });

  // When the guard reads it
  // Then it is refused
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a Cyrillic submit label is refused", () => {
  // Given a Russian-language portal's send button. JS word boundaries are
  // ASCII-only, so a \b-anchored regex matches nothing here in either direction.
  const facts = el({ text: "Отправить отклик" });

  // When the guard reads it
  // Then it is still refused
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a button with no type inside a form is refused, whatever it says", () => {
  // Given a button in a form that declares no type. HTML makes that a submit
  // button, so "Weiter" is the label of a control that sends the application.
  const facts = el({ type: "", explicitType: false, text: "Weiter" });

  // When the guard reads it
  // Then it is refused on the HTML default, not on its wording
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: an unlabelled button inside a form is refused", () => {
  // Given an icon-only control with no aria-label either: nothing distinguishes
  // it from the submit button of the form it sits in
  const facts = el({ text: "", aria: "" });

  // When the guard reads it
  // Then it is refused rather than guessed at
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a submit label is not hidden by an aria-label that outranks it", () => {
  // Given stale markup: the button reads "Submit application" on screen, and its
  // aria-label, which wins the label, says something harmless
  const facts = el({ aria: "Continue", text: "Submit application" });

  // When the guard reads it
  // Then the wording the user can see is refused too, not only the winning label
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a link is not a submit control", () => {
  // Given the "Next" link of a multi-step posting
  const facts = el({ tag: "a", type: "", explicitType: false, role: "link", inForm: false, text: "Next" });

  // When the guard reads it
  // Then the loop may click it
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a declared non-submit button is allowed", () => {
  // Given the button that pages a multi-step form forward
  const facts = el({ text: "Next step" });

  // When the guard reads it
  // Then the loop may click it
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: an ordinary text field is allowed", () => {
  // Given a field the loop exists to fill
  const facts = el({ tag: "input", type: "text", name: "email" });

  // When the guard reads it
  // Then it is not mistaken for a control that sends anything
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a labelled icon button inside a form is allowed", () => {
  // Given a repeat-section control that does say what it does
  const facts = el({ aria: "Add another", text: "" });

  // When the guard reads it
  // Then having a name is what separates it from the icon-only case above
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: outside a form, a typeless button is allowed", () => {
  // Given a listing page's "Load more", which belongs to no form
  const facts = el({ type: "", explicitType: false, inForm: false, text: "Load more" });

  // When the guard reads it
  // Then there is no form for it to submit
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: outside a form, an unlabelled button is allowed", () => {
  // Given an icon-only control with no form behind it (a menu toggle, a carousel
  // arrow), which the loop still needs to be able to click
  const facts = el({ text: "", aria: "", inForm: false });

  // When the guard reads it
  // Then the empty-label rule does not reach outside a form
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a submit term past the 80-char snapshot cap is still refused", () => {
  // Given a scripted icon button whose only wording is a long aria-label that
  // ends in the submit term, past the 80 chars the snapshot line keeps
  const facts = { tag: "button", type: "button", explicitType: true, inForm: true,
    aria: "By continuing you confirm the details above are accurate and complete and you agree to submit application" };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then the decision saw the whole label, even though the snapshot line is capped
  assert.equal(refused, true);
  assert.ok(snapshotLabel(facts).length <= 80);
});

test("isSubmitControl: an unlabelled input button inside a form is refused", () => {
  // Given <input type="button"> with no text of its own, inside a form
  const facts = { tag: "input", type: "button", explicitType: true, inForm: true };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then it is refused like an unlabelled <button>: its handler can submit
  assert.equal(refused, true);
});

test("isSubmitControl: survives missing facts", () => {
  // Given a call with nothing to read (a page that changed under us)

  // When the guard reads it
  // Then it does not throw, and it does not invent a submit control either
  assert.equal(isSubmitControl(), false);
  assert.equal(isSubmitControl({}), false);
});

test("snapshotLabel: prefers the aria-label the planner is shown", () => {
  // Given an element whose sources disagree, as an icon button's do
  const facts = { tag: "button", aria: "Submit application", text: "Continue", value: "next" };

  // When building the label
  const label = snapshotLabel(facts);

  // Then the guard tests the same string the snapshot printed, so the two
  // cannot reach different conclusions about the same element
  assert.equal(label, "Submit application");
  assert.equal(isSubmitControl(el(facts)), true);
});

test("snapshotLabel: falls through the sources in order", () => {
  // Given elements named by each source in turn
  assert.equal(snapshotLabel({ placeholder: "Your email", text: "", value: "", name: "email" }), "Your email");
  assert.equal(snapshotLabel({ text: "Continue", value: "next", name: "step" }), "Continue");
  assert.equal(snapshotLabel({ value: "next", name: "step" }), "next");
  assert.equal(snapshotLabel({ name: "step" }), "step");
  assert.equal(snapshotLabel({}), "");
  assert.equal(snapshotLabel(), "");
});

test("snapshotLabel: collapses whitespace and caps the length", () => {
  // Given a button whose text is laid out across several lines, and a container
  // whose textContent runs long
  assert.equal(snapshotLabel({ text: "\n  Send   application\n" }), "Send application");
  assert.equal(snapshotLabel({ text: "x".repeat(200) }).length, 80);
});

test("SUBMIT_RX: matches the action, not every word containing it", () => {
  // Given labels that merely contain a submit term inside a longer word
  assert.equal(SUBMIT_RX.test("Resubmitted"), false);
  assert.equal(SUBMIT_RX.test("Enviarlo"), false);

  // And labels that move the form on without sending it
  assert.equal(SUBMIT_RX.test("Next"), false);
  assert.equal(SUBMIT_RX.test("Weiter"), false);
  assert.equal(SUBMIT_RX.test("Continuer"), false);

  // Then only the real ones match, punctuation and case included
  assert.equal(SUBMIT_RX.test("Submit »"), true);
  assert.equal(SUBMIT_RX.test("SEND APPLICATION"), true);
});
