// Tests for the drive loop's submit guard: which controls the planner may be
// offered, and which it is refused when it asks.
//
// This is the one rule in the app that has no fallback ("Nothing is ever
// submitted automatically"), and it is decided on element facts read from a
// live page, so neither branch is observable from the drive loop itself. Both
// bypasses that motivated this module are pinned below: a control whose only
// name is an aria-label, and a control whose label is not in English. So is the
// third shape, which is not a <button> at all: `<div role="button">Send</div>`
// inside a form, where no type rule reaches and no submit vocabulary matches.
//
// Run:  node --test tests/lib/submit-guard.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubmitControl, snapshotLabel, SUBMIT_RX, IN_FORM_RX } from "../../src/lib/apply/submit-guard.mjs";

/** The facts drive.ts reads, with the defaults of an ordinary in-form control. */
const el = (facts) => ({ tag: "button", type: "button", inForm: true, ...facts });

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
  const facts = el({ type: "", text: "Weiter" });

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

test("isSubmitControl: a submit term in any label source is refused even when another source outranks it", () => {
  // Given an <input type="button">: its accessible name (aria, which
  // labelSource prefers for display) says nothing about submitting, but its
  // value — the string an <input type="button"> actually shows — does. An
  // input has no text content to fall back to, so classifying only the
  // source labelSource picks would leave this one invisible to the guard.
  const facts = { tag: "input", type: "button", inForm: true, aria: "Continue", value: "Submit application" };

  // When the guard reads it
  // Then the value is tested on its own, not hidden behind the aria-label
  // that wins the planner's display label
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a control whose only submit-looking string is its name stays allowed", () => {
  // Given a clickable link with unrelated visible text (so the silence rule,
  // which now covers any unlabelled clickable, does not also fire here — this
  // test isolates `name` exclusion, not the silence rule) whose `name`
  // attribute happens to contain "submit" — a machine identifier the page
  // author picked, not a label any user reads
  const facts = { tag: "a", type: "", role: "link", inForm: true, name: "submit_note", text: "Learn more" };

  // When the guard reads it
  // Then it is not refused: `name` is excluded from classification on purpose
  // (see submit-guard.mjs's `names`), so a control is never mistaken for a
  // submit control for the accident of its attribute name, even though its
  // visible text gives the silence rule below nothing to refuse it on either
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: an unlabelled clickable anchor inside a form is refused, whatever its name says", () => {
  // Given an <a role="link"> with no aria, placeholder, text, value, title or
  // alt, only a `name` attribute: `name` is deliberately excluded from
  // classification, so nothing else here names this control
  const facts = { tag: "a", type: "", role: "link", inForm: true, name: "submit" };

  // When the guard reads it
  // Then it is refused like an unlabelled button: an anchor with literally no
  // name a person can read is exactly the shape this guard cannot identify,
  // and its handler can call requestSubmit() the same way a button's can
  assert.equal(isSubmitControl(facts), true);

  // And the same holds with no name at all, so this is the silence rule and
  // not a specific reaction to the string "submit"
  assert.equal(isSubmitControl({ tag: "a", type: "", role: "link", inForm: true }), true);
});

test("isSubmitControl: an unlabelled input[type=reset] inside a form is refused too, a labelled one is not", () => {
  // Given the silence rule is held to `isClickable`, which lists
  // input[type=reset] alongside submit/button/image (see submit-guard.mjs's
  // `isClickable`) — a side effect noted in the PR body's "Out of scope": a
  // reset button does not submit anything, but an unlabelled one inside a
  // form is exactly as unidentifiable as an unlabelled submit-shaped control
  const unlabelled = { tag: "input", type: "reset", inForm: true };
  const labelled = { tag: "input", type: "reset", inForm: true, value: "Reset" };

  // When the guard reads each
  // Then only the unlabelled one is refused; a reset button that says what it
  // does stays clickable, since "reset" is in neither vocabulary
  assert.equal(isSubmitControl(unlabelled), true);
  assert.equal(isSubmitControl(labelled), false);
});

test("isSubmitControl: an unlabelled anchor outside a form is allowed", () => {
  // Given the same silent shape with no form behind it
  const facts = { tag: "a", type: "", role: "link", inForm: false, name: "submit" };

  // When the guard reads it
  // Then the silence rule does not reach outside a form, same as the
  // unlabelled-button case above
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a fillable field whose secondary label merely contains a submit word stays allowed", () => {
  // Given an ordinary text field whose accessible name is unrelated, but whose
  // placeholder happens to share a word with the submit vocabulary — the kind
  // of coincidence testing every source independently now risks catching
  const facts = { tag: "input", type: "text", inForm: true, aria: "Feedback", placeholder: "Submit your feedback here" };

  // When the guard reads it
  // Then it is not refused: a text field cannot submit anything by being
  // clicked, so the submit vocabulary is held to clickable controls, the same
  // way the in-form tier already is
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a link is not a submit control", () => {
  // Given the "Next" link of a multi-step posting
  const facts = el({ tag: "a", type: "", role: "link", inForm: false, text: "Next" });

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
  const facts = el({ type: "", inForm: false, text: "Load more" });

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
  const facts = { tag: "button", type: "button", inForm: true,
    aria: "By continuing you confirm the details above are accurate and complete and you agree to submit application" };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then the decision saw the whole label, even though the snapshot line is capped
  assert.equal(refused, true);
  assert.ok(snapshotLabel(facts).length <= 80);
});

test("isSubmitControl: an unlabelled input button inside a form is refused", () => {
  // Given <input type="button"> with no text of its own, inside a form
  const facts = { tag: "input", type: "button", inForm: true };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then it is refused like an unlabelled <button>: its handler can submit
  assert.equal(refused, true);
});

test("isSubmitControl: an apply verb outside a form is the way in, and stays actionable", () => {
  // Given the entry links portals ship before any form exists
  const links = [
    { tag: "a", role: "link", inForm: false, text: "Postuler" },
    { tag: "a", role: "link", inForm: false, text: "Apply for this job" },
    { tag: "button", type: "button", inForm: false, text: "Candidati" },
    { tag: "button", type: "button", inForm: false, text: "Solliciteren" },
    { tag: "button", type: "button", inForm: false, text: "Aplikuj" },
  ];

  // When the guard classifies each
  const refused = links.filter((facts) => isSubmitControl(facts));

  // Then none is refused: without them the loop could never reach the form
  assert.deepEqual(refused, []);
});

test("isSubmitControl: the same apply verb inside a form is the final button and is refused", () => {
  // Given declared type="button" controls (so the type rule does not fire) inside a form
  const finals = [
    { tag: "button", type: "button", inForm: true, text: "Postuler" },
    { tag: "button", type: "button", inForm: true, text: "Apply" },
    { tag: "button", type: "button", inForm: true, text: "Apply now" },
    { tag: "button", type: "button", inForm: true, text: "Bewerben" },
  ];

  // When the guard classifies each
  const allowed = finals.filter((facts) => !isSubmitControl(facts));

  // Then every one is refused
  assert.deepEqual(allowed, []);
});

test("isSubmitControl: «Откликнуться» is refused even outside a form, because hh.ru sends the response on that click", () => {
  // Given hh.ru's respond button, a declared button outside any form
  const facts = { tag: "button", type: "button", inForm: false, text: "Откликнуться" };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then it is refused: that click is the submission
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

test("isSubmitControl: a div with role=button reading \"Send\" inside a form is refused", () => {
  // Given the shape a custom ATS ships as its final button: not a <button>, so no
  // type rule reaches it, and named by a verb no submit vocabulary contains
  const facts = { tag: "div", role: "button", inForm: true, text: "Send" };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then role="button" is read as a button, and bare "send" is refused inside a
  // form: this is the one shape where a click files the application silently
  assert.equal(refused, true);
});

test("isSubmitControl: a native button reading \"Send\" inside a form is refused", () => {
  // Given the same wording on a declared type="button", so only the tier decides
  const facts = { tag: "button", type: "button", inForm: true, text: "Send" };

  // When the guard classifies it
  // Then the in-form tier refuses it
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: outside a form, \"Send\" is allowed", () => {
  // Given "Send to a friend" on a listing page, which sends nothing of ours
  const facts = { tag: "button", type: "button", inForm: false, text: "Send to a friend" };

  // When the guard classifies it
  // Then the tier does not reach outside a form, so the loop keeps the click
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a checkbox reading \"Send me updates\" inside a form is allowed", () => {
  // Given the marketing opt-in every application form carries. A click cannot
  // submit it, so the in-form tier is held to clickables
  const facts = { tag: "input", type: "checkbox", inForm: true, name: "Send me updates" };

  // When the guard classifies it
  // Then it stays actionable: refusing it would cost a turn and protect nothing
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: an unlabelled div with role=button inside a form is refused", () => {
  // Given an icon-only control that is not a <button> at all
  const facts = { tag: "div", role: "button", inForm: true, text: "" };

  // When the guard classifies it
  // Then silence inside a form is refused whatever the tag, because the shape we
  // cannot identify is exactly the shape of the button that sends the form
  assert.equal(isSubmitControl(facts), true);
});

test("isSubmitControl: a div with role=button and no type is allowed inside a form when it says what it does", () => {
  // Given a scripted control in a form, named, and not a <button>: HTML's
  // typeless default is about <button>, and a <div> submits nothing on its own
  const facts = { tag: "div", role: "button", inForm: true, text: "Add another position" };

  // When the guard classifies it
  // Then it stays actionable — the default rule does not follow role="button"
  assert.equal(isSubmitControl(facts), false);
});

test("isSubmitControl: a control named only by its title is refused", () => {
  // Given a floating icon button that sits outside the <form> it submits, so the
  // structural rules do not reach it, and whose only name is a title attribute
  const facts = { tag: "button", type: "button", inForm: false, title: "Bewerbung absenden" };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then the title is read for classification, and the snapshot line is not
  // widened by it: the planner still sees what it saw before
  assert.equal(refused, true);
  assert.equal(snapshotLabel(facts), "");
});

test("isSubmitControl: an icon named only by its alt is refused", () => {
  // Given <img role="button" alt="Отправить">, a clickable image whose only
  // wording lives in alt — it has no text, no value and no aria-label
  const facts = { tag: "img", role: "button", inForm: false, alt: "Отправить" };

  // When the guard classifies it
  const refused = isSubmitControl(facts);

  // Then alt counts as a name, and again only for the guard
  assert.equal(refused, true);
  assert.equal(snapshotLabel(facts), "");
});

test("isSubmitControl: a name that exists only through aria-labelledby is refused", () => {
  // Given a button labelled by another element's text (`aria-labelledby="t9"`).
  // drive.ts resolves that into `aria` in the page, because reading the
  // aria-label attribute alone would leave the guard classifying an empty string
  const facts = { tag: "div", role: "button", inForm: true, text: "", aria: "Submit application" };

  // When the guard classifies it
  // Then the resolved accessible name is refused like any other label
  assert.equal(isSubmitControl(facts), true);
});

test("IN_FORM_RX: matches the verb, not every word containing it", () => {
  // Given words that merely contain "send" or "apply"
  assert.equal(IN_FORM_RX.test("Resend code"), false);
  assert.equal(IN_FORM_RX.test("Sender name"), false);
  assert.equal(IN_FORM_RX.test("Applying filters"), false);

  // Then only the verbs match, punctuation and case included
  assert.equal(IN_FORM_RX.test("Send"), true);
  assert.equal(IN_FORM_RX.test("SEND »"), true);
  assert.equal(IN_FORM_RX.test("Apply now"), true);
});
