/**
 * drive-action.mjs — the agentic drive loop's action executor: the one place a
 * planner action is turned into something done to the page
 * (`web/src/lib/apply/drive.ts` calls it once per turn).
 *
 * NEVER-SUBMIT is enforced here at runtime. `submit-guard.mjs` is the rule
 * ("would clicking this submit the application?"); this is where the rule is
 * applied, on the element as it is at the moment of acting, and where a later
 * edit can drop it without touching the rule: a new action branch that skips the
 * check, a selector resolved again after it, a fallback that acts on an element
 * the main path refused.
 *
 * Plain .mjs (same pattern as submit-guard.mjs / exit.mjs) so `node --test`
 * imports it without the planner, the CLI spawn or the `@/` alias loader, and
 * drives it against a fake page: tests/lib/apply-drive.test.mjs.
 */

import { isSubmitControl, snapshotLabel } from "./submit-guard.mjs";

/**
 * What the guard decides on, read from the live DOM. See submit-guard.mjs.
 *
 * @typedef {{ ref: string, tag: string, type: string, role: string, inForm: boolean,
 *             aria: string, placeholder: string, text: string, value: string,
 *             name: string, title: string, alt: string }} ElementFacts
 */

/**
 * One planner action, as parsed from its reply.
 *
 * @typedef {{ action: string, ref?: string, text?: string, value?: string }} DriveAction
 */

/**
 * What executing one action came to. `refusal` is set only when the action was
 * refused; `note` is its human sentence ("" when there is nothing to add).
 *
 * @typedef {{ detail: string, note: string,
 *             refusal?: import("./issue").DriveStep["refusal"] }} ActionOutcome
 */

/** Read one element's facts, in the page. Defined once, at the top level, and
 *  handed to Playwright as the pageFunction for both call sites: the snapshot
 *  that decides which elements the planner may address, and the re-check the
 *  action path runs on the handle it is about to act on. Two extractors would
 *  eventually disagree, and the disagreement is the bug.
 *
 *  Playwright serialises it by source and runs it in the page, so it closes over
 *  nothing here — everything it needs is the element and its ref.
 *
 *  @param {Element} el
 *  @param {string | null} ref
 *  @returns {ElementFacts} */
export const factsOf = (el, ref) => {
  const field = /** @type {HTMLInputElement} */ (el);
  const tag = el.tagName.toLowerCase();
  const flat = (/** @type {string | null} */ s) => (s || "").replace(/\s+/g, " ").trim();
  // The accessible name, not just the attribute: a control named through
  // aria-labelledby has no aria-label at all, and reading only the attribute
  // would leave the guard classifying an empty string.
  let aria = flat(el.getAttribute("aria-label"));
  if (!aria) {
    const ids = flat(el.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
    aria = flat(ids.map((id) => document.getElementById(id)?.textContent || "").join(" ")).slice(0, 200);
  }
  return {
    ref: ref || el.getAttribute("data-co-ref") || "",
    tag,
    type: flat(el.getAttribute("type")).toLowerCase(),
    role: flat(el.getAttribute("role")).toLowerCase() || (tag === "a" ? "link" : tag),
    // `.form` also covers a control placed outside its form by form="id".
    inForm: Boolean(field.form) || el.closest("form") !== null,
    aria,
    placeholder: field.placeholder || "",
    // Capped here, not in Node: a [role="button"] can wrap a whole section, and
    // 70 of those would cross the wire in full every turn. Well above the 80
    // chars the snapshot line keeps, but still a cap ahead of classification:
    // a submit phrase past character 200 of an unusually large clickable is
    // invisible to isSubmitControl. Accepted: the alternative is unbounded text
    // per element every turn, or classifying inside the page.
    text: flat(el.textContent).slice(0, 200),
    value: field.value || "",
    name: field.name || "",
    // Classification only (see submit-guard.mjs): they name an icon-only
    // control that carries nothing else, and never reach the snapshot line.
    // Same 200-char cap and the same caveat as `text` above.
    title: flat(el.getAttribute("title")).slice(0, 200),
    alt: flat(el.getAttribute("alt")).slice(0, 200),
  };
};

/**
 * Execute one planner action on OUR session — NEVER submit.
 *
 * `actionable` is the set of refs this turn's snapshot offered; an action naming
 * any other ref is refused before the page is consulted. Never throws: a failed
 * action is reported in `detail`, and the handle is released either way.
 *
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Frame} frame
 * @param {DriveAction} act
 * @param {Set<string>} actionable
 * @returns {Promise<ActionOutcome>}
 */
export async function executeAction(page, frame, act, actionable) {
  let detail = "";
  let note = "";
  /** @type {ActionOutcome["refusal"]} */
  let refusal;
  /** @type {import("playwright-core").ElementHandle<SVGElement | HTMLElement> | null} */
  let handle = null;
  try {
    // Every action naming a ref is cleared before anything is done to it, not
    // just click: `fill()` on a button throws into a fallback that clicks. The
    // check and the action are bound to ONE element handle, because resolving
    // the selector again after the check lets the DOM hand the action a
    // different node than the one that was cleared. The element is re-read
    // here because the page can change between the snapshot and now, and being
    // unreadable counts as refused: an element we cannot describe is one we
    // cannot clear.
    const ref = act.ref !== undefined && actionable.has(act.ref) ? act.ref : null;
    handle = ref !== null ? await frame.$(`[data-co-ref="${ref}"]`).catch(() => null) : null;
    const now = handle ? await handle.evaluate(factsOf, ref).catch(() => null) : null;
    const label = now ? snapshotLabel(now) : "";
    const target = now && !isSubmitControl(now) ? handle : null;
    if (act.ref !== undefined && !target) {
      // Three different refusals, told apart: only one of them is the guard
      // doing its job, and a UI that calls a vanished element a submit button
      // teaches the user to distrust the message that matters.
      const named = String(act.ref).slice(0, 24);
      if (ref === null) {
        refusal = "not-offered";
        note = "not offered this turn";
        detail = `blocked ref ${named} (not offered this turn)`;
      } else if (!now) {
        refusal = "gone";
        note = "element gone";
        detail = `blocked ref ${named} (gone)`;
      } else {
        refusal = "submit-control";
        note = "refused to click a submit control (the human submits)";
        detail = `blocked submit "${label.slice(0, 40)}"`;
      }
    } else if (act.action === "click" && target) {
      detail = `click "${label.slice(0, 40)}"`;
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {}), target.click({ timeout: 6000 })]);
    } else if (act.action === "type" && target) {
      detail = `type into ${label.slice(0, 40) || ref}`;
      // Same explicit 6s as the click branch above, for a predictable bound
      // on this fallback's own click: session.ts sets an 8s context default
      // (`context.setDefaultTimeout(8000)`), so this was already bounded,
      // just two seconds looser than the action this loop otherwise treats
      // as its click budget.
      // The fallback inserts text instead of typing it: keyboard.type presses a real key per
      // character, so a "\n" or "\r" in the planner's text was an Enter on a focused control,
      // which is implicit form submission and bypassed the never-submit guard. insertText
      // dispatches no key events, and line breaks are flattened to spaces before it.
      await target.fill(act.text || "").catch(async () => {
        await target.click({ timeout: 6000 });
        await page.keyboard.insertText(String(act.text || "").replace(/[\r\n]+/g, " "));
      });
    } else if (act.action === "select" && target) {
      detail = `select "${act.value}"`;
      await target.selectOption({ label: act.value || "" }, { timeout: 6000 }).catch(() => target.selectOption(act.value || "", { timeout: 6000 }));
    } else if (act.action === "scroll") {
      detail = "scroll";
      await page.evaluate(() => window.scrollBy(0, 700)).catch(() => {});
    } else {
      detail = `unknown action ${act.action}`;
    }
  } catch (e) {
    detail = `${act.action} failed: ${e instanceof Error ? e.message.slice(0, 50) : "err"}`;
  } finally {
    await handle?.dispose().catch(() => {});
  }
  return { detail, note, refusal };
}
