/**
 * submit-guard.mjs — the one definition of "this control submits the form",
 * shared by the two places in the agentic drive loop that have to agree on it
 * (`web/src/lib/apply/drive.ts`): the snapshot that decides which elements the
 * planner may address, and the action path that executes what it picked.
 *
 * NEVER-SUBMIT is by construction here (`web/AGENTS.md`: "There is no exception,
 * no flag"), so the guard cannot rest on a string the planner never saw. The
 * snapshot labels an element `aria-label || placeholder || text || value ||
 * name`; the click guard used to test `innerText || value` only, which is empty
 * for an icon-only `<button aria-label="Submit application">`, against a regex
 * of English and Spanish words, which does not contain "Absenden" or
 * "Отправить". Both call sites now read the same element facts and call the same
 * predicate.
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
 * - `explicitType` the element declares a type the browser honours. A `<button>`
 *                  honours only submit/reset/button, so an absent, empty or
 *                  unrecognised type still submits.
 * - `role`         explicit role, else the tag (`a` reads as "link")
 * - `inForm`       the element belongs to a `<form>`
 * - `aria` `placeholder` `text` `value` `name`  the label sources, raw
 *
 * @typedef {{ tag?: string, type?: string, explicitType?: boolean, role?: string,
 *             inForm?: boolean, aria?: string, placeholder?: string, text?: string,
 *             value?: string, name?: string }} ElementFacts
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
 * @param {ElementFacts} [facts]
 */
export function snapshotLabel(facts = {}) {
  return clean(labelSource(facts));
}

const labelSource = (facts) => facts.aria || facts.placeholder || facts.text || facts.value || facts.name;

// Words that name the final action on a job application, in the languages the
// portals we drive actually ship. Deliberately bounded: every entry here costs
// the loop a click it could otherwise make, so this is the "sends it" vocabulary
// and not everything that moves a form forward ("next", "continue", "weiter").
const SUBMIT_TERMS = [
  // en
  "submit", "send application", "finish( application)?", "complete application", "apply (and|&) submit",
  // es
  "enviar", "finalizar",
  // de
  "absenden", "abschicken", "bewerbung senden",
  // fr
  "envoyer", "soumettre", "postuler",
  // it
  "invia", "candidati",
  // pt
  "enviar candidatura", "submeter",
  // nl
  "verzenden", "solliciteren",
  // pl
  "wyślij", "aplikuj",
  // ru
  "отправить", "откликнуться",
];

/**
 * Matches a label naming the submit action.
 *
 * The boundaries are `\p{L}` classes under the `u` flag rather than `\b`,
 * because JS word boundaries are ASCII-only: `/\bотправить\b/` matches nothing
 * at all, in either direction, so a Cyrillic submit button reads as ordinary
 * text. Not global, so the exported regex holds no `lastIndex` between calls.
 */
export const SUBMIT_RX = new RegExp(`(^|[^\\p{L}])(${SUBMIT_TERMS.join("|")})($|[^\\p{L}])`, "iu");

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
  if (tag === "input" && (type === "submit" || type === "image")) return true;
  if (tag === "button" && (type === "submit" || (!facts.explicitType && facts.inForm))) return true;
  // Classified on the full label, not the 80-char snapshot line: a scripted
  // control whose submit wording sits past the display cap still submits.
  const label = collapse(labelSource(facts));
  // The visible text is tested even when an aria-label outranks it: markup that
  // labels a button reading "Submit application" as "Continue" would otherwise
  // hide the wording from the guard while still showing it to the user.
  if (SUBMIT_RX.test(label) || SUBMIT_RX.test(collapse(facts.text))) return true;
  // No wording at all inside a form: an icon-only <button>, or an
  // <input type="button"> that submits through its handler. Refused rather
  // than guessed at.
  if (!label && facts.inForm && (tag === "button" || (tag === "input" && type === "button"))) return true;
  return false;
}
