/**
 * submit-guard.mjs — the one definition of "this control submits the form",
 * shared by the two places in the agentic drive loop that have to agree on it
 * (`web/src/lib/apply/drive.ts`): the snapshot that decides which elements the
 * planner may address, and the action path that executes what it picked.
 *
 * NEVER-SUBMIT is by construction for the planner's ACTION VOCABULARY
 * (`web/AGENTS.md`: "There is no exception, no flag"): there is no "submit"
 * action to issue, a control this guard recognises as a submit control is
 * listed with no ref so it cannot be named, and the guard cannot rest on a
 * string the planner never saw. The snapshot labels an element
 * `aria-label || placeholder || text || value || name`; the click guard used
 * to test `innerText || value` only, which is empty for an icon-only
 * `<button aria-label="Submit application">`, against a regex of English and
 * Spanish words, which does not contain "Absenden" or "Отправить". Both call
 * sites now read the same element facts and call the same predicate.
 *
 * What this does NOT construct away: an allowed control's own JS handler can
 * still call `form.submit()`/`requestSubmit()` on a click this guard has no
 * wording or shape to object to (a `<button type="button">Continue</button>`
 * that quietly files the form). No DOM heuristic closes that; only an
 * independent interlock on the `submit`/`requestSubmit` event itself would,
 * and that is the documented next step (PR body, "Out of scope"), not this
 * guard's job.
 *
 * Plain .mjs (same pattern as exit.mjs / cv-match.mjs) so `node --test` imports
 * it with no build step and every branch can be pinned in a test.
 */

/**
 * The facts both call sites decide on, read from the live DOM by `drive.ts`:
 *
 * - `tag`          lowercase tag name
 * - `type`         the authored `type` attribute, lowercased ("" when absent).
 *                  Not `el.type`: the DOM resolves a missing button type to
 *                  "submit", which would hide the case below it.
 * - `role`         explicit role, else the tag (`a` reads as "link")
 * - `inForm`       the element belongs to a `<form>`
 * - `aria` `placeholder` `text` `value` `name`  the label sources, raw. `aria`
 *                  is the accessible name: `aria-label`, or the text of the
 *                  `aria-labelledby` targets when there is no `aria-label`.
 * - `title` `alt`  further names an icon-only control can carry. Classification
 *                  only: they never reach the snapshot line (see snapshotLabel).
 *
 * @typedef {{ tag?: string, type?: string, role?: string, inForm?: boolean,
 *             aria?: string, placeholder?: string, text?: string, value?: string,
 *             name?: string, title?: string, alt?: string }} ElementFacts
 */

// Whitespace-collapsed, uncapped: what the guard classifies on.
const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();
// The 80-char cap is for the snapshot line the planner reads, never for the
// decision: a submit term past the cap must still be seen by the guard.
const clean = (s) => collapse(s).slice(0, 80);

/**
 * The label the planner is shown for an element, and therefore a string the
 * guard is obliged to test.
 *
 * Deliberately narrower than what the guard reads: this is the planner's view
 * of the page, so it stays the five sources the snapshot has always printed.
 * `title` and `alt` widen the guard, not the planner.
 *
 * @param {ElementFacts} [facts]
 */
export function snapshotLabel(facts = {}) {
  return clean(labelSource(facts));
}

const labelSource = (facts) => facts.aria || facts.placeholder || facts.text || facts.value || facts.name;

/**
 * Every string that names this control, for classification only.
 *
 * Each source is tested on its own, not funnelled through `labelSource`'s
 * single winner: `aria` outranks `value` for the planner's display label, but
 * a control whose `aria` says "Continue" and whose `value` says "Submit
 * application" still submits — an `input[type="button"]` has no `text` to
 * fall back to, so testing only the winning source would let the losing one
 * hide the wording from the guard entirely. Deduplicated so two sources that
 * agree are not tested twice.
 *
 * `name` is deliberately left out: it is a machine identifier, not a label a
 * person reads — a field `name="submit_note"` names a text box, not a submit
 * action — so folding it in here would refuse ordinary fields for the
 * accident of their attribute name. It stays in `labelSource`, used only by
 * `snapshotLabel` below, where guessing wrong just shows the planner a worse
 * fallback label, never a false submit refusal.
 */
const names = (facts) => {
  const seen = new Set();
  const out = [];
  for (const raw of [facts.aria, facts.placeholder, facts.text, facts.value, facts.title, facts.alt]) {
    const s = collapse(raw);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
};

// Two vocabularies, because the same verb means two things on a job portal.
//
// SUBMIT_TERMS name the action that sends the application, in the languages
// the portals we drive actually ship. Refused wherever they appear. Deliberately
// bounded: every entry costs the loop a click it could otherwise make, so this
// is the "sends it" vocabulary and not everything that moves a form forward
// ("next", "continue", "weiter"). «Откликнуться» sits here and not below
// because on hh.ru that button sends the response in one click.
const SUBMIT_TERMS = [
  // en
  "submit", "send application", "finish( application)?", "complete application", "apply (and|&) submit",
  // es
  "enviar", "finalizar",
  // de
  "absenden", "abschicken", "bewerbung senden",
  // fr
  "envoyer", "soumettre",
  // it
  "invia",
  // pt
  "enviar candidatura", "submeter",
  // nl
  "verzenden",
  // pl
  "wyślij",
  // ru
  "отправить", "откликнуться",
];

// IN_FORM_TERMS are refused only on a clickable inside a form. Outside a form
// the apply verbs are the entry point the loop exists to click ("Apply for this
// job", <a>Postuler</a>); inside one the same word is the final button. Bare
// "send" sits here for the same reason: on a listing page it is "Send to a
// friend", on the last step of a form it is the button that files the
// application, and a custom ATS ships exactly that as
// `<div role="button">Send</div>`, which no type or tag rule can catch.
const IN_FORM_TERMS = [
  "apply( now| for this job)?",
  "postuler", "candidati", "candidatar-se", "solliciteren", "aplikuj", "bewerben",
  "send",
];

const wordRx = (terms) => new RegExp(`(^|[^\\p{L}])(${terms.join("|")})($|[^\\p{L}])`, "iu");

/**
 * Matches a label naming the submit action.
 *
 * The boundaries are `\p{L}` classes under the `u` flag rather than `\b`,
 * because JS word boundaries are ASCII-only: `/\bотправить\b/` matches nothing
 * at all, in either direction, so a Cyrillic submit button reads as ordinary
 * text. Not global, so the exported regex holds no `lastIndex` between calls.
 */
export const SUBMIT_RX = wordRx(SUBMIT_TERMS);

/** Matches the in-form tier: refused only on a clickable inside a form. */
export const IN_FORM_RX = wordRx(IN_FORM_TERMS);

/**
 * A control a click can act on. The in-form tier is held to this, so a checkbox
 * labelled "Send me updates", or a field whose placeholder says "Apply by…",
 * stays fillable: neither can file an application, and refusing them would cost
 * the loop a turn for nothing.
 */
const isClickable = (tag, type, role) =>
  tag === "button" || tag === "a" || role === "button" || role === "link" || (tag === "input" && ["button", "submit", "reset", "image"].includes(type));

/**
 * Would clicking this element submit the application?
 *
 * Independent readings, because each one alone has a blind spot: the element's
 * own type, HTML's default (a `<button>` inside a `<form>` with no honoured
 * type is a submit button), the wording (both the label and the visible text
 * an aria-label can outrank), and the absence of any wording — an icon-only
 * control inside a form is exactly the shape of the submit button we cannot
 * identify, so it is refused rather than guessed at.
 *
 * @param {ElementFacts} [facts]
 */
export function isSubmitControl(facts = {}) {
  const tag = (facts.tag || "").toLowerCase();
  const type = (facts.type || "").toLowerCase();
  const role = (facts.role || "").toLowerCase();
  if (tag === "input" && (type === "submit" || type === "image")) return true;
  // A <button> honours only submit/reset/button; with anything else — absent,
  // empty, misspelt — it is still a submit button inside a form. Derived here
  // from tag and type rather than sent from the page: one less fact for the two
  // sides of the wire to disagree about.
  const declared = ["submit", "reset", "button"].includes(type);
  if (tag === "button" && (type === "submit" || (!declared && facts.inForm))) return true;
  // Classified on the full label, not the 80-char snapshot line: a scripted
  // control whose submit wording sits past the display cap still submits.
  // Every source is read on its own — text, placeholder and value all read
  // even when an aria-label outranks them for display — so markup that labels
  // a button reading "Submit application" as "Continue" cannot hide the
  // wording from the guard while still showing it to the user, and `title`
  // and `alt` are read because an icon-only control is often named by them
  // alone. Held to `isClickable` for the same reason the tier below is: a
  // click is the only thing this guard is deciding about, so a fillable field
  // whose placeholder happens to read "Submit your feedback" is not one, and
  // reading every source independently must not turn that ordinary field into
  // one just because its secondary label shares a word with the vocabulary.
  const named = names(facts);
  if (isClickable(tag, type, role) && named.some((s) => SUBMIT_RX.test(s))) return true;
  // `role="button"` counts as a button here and for the silence rule below, but
  // NOT for HTML's typeless default above: a <div> does not submit on its own,
  // while its wording and its silence read exactly like a <button>'s, and its
  // handler can call requestSubmit() either way.
  if (facts.inForm && isClickable(tag, type, role) && named.some((s) => IN_FORM_RX.test(s))) return true;
  // No wording at all inside a form: an icon-only <button>, a
  // <div role="button">, an unlabelled <a>, or an <input type="button"> that
  // submits through its handler. Held to `isClickable`, not to button/input
  // only: a clickable anchor with no aria, placeholder, text, value, title or
  // alt is exactly as unidentifiable as a silent <button>, and its handler can
  // call requestSubmit() the same way. Refused rather than guessed at, same as
  // the two rules above.
  if (!named.length && facts.inForm && isClickable(tag, type, role)) return true;
  return false;
}
