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
 *             name: string, title: string, alt: string, group: string, question: string,
 *             option: string, identity: string }} ElementFacts
 */

/**
 * One planner action, as parsed from its reply.
 *
 * @typedef {{ action: string, ref?: string, text?: string, value?: string,
 *            expected?: { label?: string, group?: string, question?: string, option?: string, identity?: string },
 *            ensureChecked?: boolean }} DriveAction
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
  const labelText = (node) => {
    const id = node.getAttribute("id");
    const external = id && typeof document !== "undefined" ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrap = node.closest("label");
    const host = external || wrap;
    if (!host) return "";
    const copy = host.cloneNode(true);
    copy.querySelectorAll("input, select, textarea, button").forEach((control) => control.remove());
    return flat(copy.textContent).slice(0, 200);
  };
  const ownLabel = labelText(el);
  // Extraction names a choice from aria-label before the visible label. A
  // shared accessible name is the question, so the value is the choice. A
  // UUID or a generic prompt is not a name, and the visible label is used.
  const usable = (s) => {
    const t = flat(s);
    if (!t) return "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return "";
    if (/^(start typing|select\b|choose|search\b|type\b|--|please select|e\.?g\.?)/i.test(t)) return "";
    return t.slice(0, 200);
  };
  const choiceLabel = (node) => {
    const named = usable(node.getAttribute("aria-label"));
    if (named) return named;
    const ids = flat(node.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
    if (ids.length && typeof document !== "undefined") {
      const fromIds = usable(ids.map((id) => document.getElementById(id)?.textContent || "").join(" "));
      if (fromIds) return fromIds;
    }
    return labelText(node);
  };
  const option = (() => {
    const type = flat(el.getAttribute("type")).toLowerCase();
    if (type !== "radio" && type !== "checkbox") return "";
    const value = flat(field.value);
    const name = field.name || "";
    const ownChoice = choiceLabel(el);
    let labels = [ownChoice];
    if (name && typeof document !== "undefined") {
      // One form's group only, as extraction groups them: a same-name control
      // in another form is not an option of this question.
      const nodes = Array.from(document.querySelectorAll(`input[type="${CSS.escape(type)}"][name="${CSS.escape(name)}"]`))
        .filter((node) => node.form === field.form);
      if (nodes.length) labels = nodes.map((node) => choiceLabel(node));
    }
    const shared = labels.length > 1 && labels.every((text) => text && text === labels[0]);
    // Same rule as extract: a shared label is the question, so the value is the
    // choice. Distinct labels are the choices themselves.
    if (!ownChoice || ownChoice === name || (shared && value)) return (value || ownChoice).slice(0, 200);
    return (ownChoice || value).slice(0, 200);
  })();
  // Same order as extraction's labelFor. A heading in the field wrapper is the
  // name when the control has no aria name and no label element. Placeholder
  // and the input name come after that, so they cannot hide the heading.
  const pure = (node) => {
    if (!node) return "";
    if (typeof node.cloneNode !== "function") return flat(node.textContent);
    const copy = node.cloneNode(true);
    if (copy.querySelectorAll) copy.querySelectorAll("input, select, textarea, option, button, [role=option]").forEach((control) => control.remove());
    return flat(copy.textContent);
  };
  const shown = (node) => {
    // Same rule as extractForm's isVisibleNode: a visibility:hidden label keeps
    // its layout box, and naming a field after it would make the two paths
    // disagree on the field, so its listed answer would be refused.
    if (typeof getComputedStyle === "function" && getComputedStyle(node).visibility === "hidden") return false;
    let current = node;
    const body = typeof document !== "undefined" ? document.body : null;
    while (current && current !== body) {
      if (current.offsetParent != null) return true;
      if (typeof getComputedStyle !== "function") return false;
      if (getComputedStyle(current).display !== "contents") return false;
      current = current.parentElement;
    }
    return body != null && current === body;
  };
  const otherControl = (container) => {
    if (!container?.querySelectorAll) return false;
    const ownName = field.name || "";
    for (const node of Array.from(container.querySelectorAll("input, textarea, select"))) {
      if (node === el) continue;
      const nodeType = flat(node.getAttribute?.("type")).toLowerCase();
      const nodeTag = String(node.tagName || "").toLowerCase();
      if (nodeTag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(nodeType)) continue;
      // The same rule as extraction's isEligibleControl: a control with no box
      // or one hidden with visibility:hidden is not another question. A styled
      // radio or checkbox hides its own input, so it still counts while one of
      // its labels or its parent renders.
      const hiddenStyle = (n) => typeof getComputedStyle === "function" && getComputedStyle(n).visibility === "hidden";
      if (node.offsetParent == null || hiddenStyle(node)) {
        if (nodeType !== "radio" && nodeType !== "checkbox") continue;
        const rendered = (proxy) =>
          !!proxy && (typeof proxy.getClientRects !== "function" || proxy.getClientRects().length > 0) && !hiddenStyle(proxy);
        const labels = Array.from(node.labels ?? []);
        if (!labels.some(rendered) && !rendered(node.parentElement)) continue;
      }
      if (typeof node.closest === "function" && node.closest('[class*="autofill" i]')) continue;
      if (nodeType === "radio" && ownName && (node.name || "") === ownName) continue;
      const shell = typeof node.closest === "function" && node.closest('[class*="select__"], .select-shell');
      if (shell && node.getAttribute?.("role") !== "combobox" && el.getAttribute("role") === "combobox") continue;
      return true;
    }
    return false;
  };
  const firstShown = (container, selector) => {
    if (!container?.querySelectorAll) return "";
    const lab = Array.from(container.querySelectorAll(selector)).find((node) => shown(node));
    return lab ? usable(pure(lab)) : "";
  };
  const identity = (() => {
    const named = usable(aria);
    if (named) return named;
    const fromLabel = usable(ownLabel);
    if (fromLabel) return fromLabel;
    const grp = typeof el.closest === "function"
      ? el.closest('[class*="field-entry" i], [class*="fieldEntry" i], [class*="form-group" i], [class*="question" i], [class*="field__" i], [class*="__field" i], fieldset, [class*="field" i]')
      : null;
    if (grp && !otherControl(grp)) {
      const fromGroup = firstShown(grp, 'label, legend, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i]');
      if (fromGroup) return fromGroup;
    }
    let parent = el.parentElement;
    for (let i = 0; i < 4 && parent; i += 1, parent = parent.parentElement) {
      if (otherControl(parent)) break;
      const fromParent = firstShown(parent, 'label, legend, [class*="label" i], [class*="title" i], h3, h4, h5');
      if (fromParent) return fromParent;
    }
    return usable(field.placeholder) || usable(field.name);
  })();
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
    group: (() => {
      const rg = el.closest("[role=radiogroup], fieldset");
      if (!rg) return "";
      const own = flat(rg.getAttribute("aria-label"));
      if (own) return own.slice(0, 200);
      const ids = flat(rg.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
      const named = flat(ids.map((id) => document.getElementById(id)?.textContent || "").join(" "));
      if (named) return named.slice(0, 200);
      return flat(rg.querySelector("legend")?.textContent || "").slice(0, 200);
    })(),
    question: ownLabel,
    option,
    identity,
  };
};

function usableName(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return "";
  if (/^(start typing|select\b|choose|search\b|type\b|--|please select|e\.?g\.?)/i.test(t)) return "";
  return t.slice(0, 200);
}

/** The name extraction would give a text field. factsOf stores that name on
 *  `identity`, including a heading in the field wrapper. A partial fact falls
 *  back to the aria name, then the visible label, then the snapshot.
 *
 * @param {ElementFacts | { aria?: string, question?: string, identity?: string }} [facts]
 * @returns {string}
 */
export function listedFieldLabel(facts) {
  return facts?.identity || usableName(facts?.aria) || usableName(facts?.question) || snapshotLabel(facts || {});
}

/**
 * One snapshot line. When the option differs from the label, name it. Two
 * radios that share an accessible name would otherwise look identical, and
 * the planner could not tell which value it is clicking.
 *
 * @param {string} ref
 * @param {string} kind
 * @param {string} label
 * @param {string} [option]
 * @returns {string}
 */
export function snapshotChoiceLine(ref, kind, label, option) {
  const choice = option && option !== label ? ` option "${option}"` : "";
  return `[${ref}] ${kind} "${label}"${choice}`;
}

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
    // The snapshot stores listedFieldLabel, which can fall through to the
    // placeholder when the raw identity is empty. Compare that same value.
    const identity = now ? listedFieldLabel(now) : "";
    const target = now && !isSubmitControl(now) ? handle : null;
    const expected = act.expected;
    const drifted = !!(expected && now && (
      label !== (expected.label || "")
      || (now.group || "") !== (expected.group || "")
      || (now.question || "") !== (expected.question || "")
      || (now.option || "") !== (expected.option || "")
      || (expected.identity !== undefined && identity !== expected.identity)
    ));
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
    } else if (drifted && target) {
      // The ref still points at a node, but the question on it changed while
      // the planner was thinking. The answer was checked against the old one.
      note = "left blank";
      detail = "blocked a field whose label changed";
    } else if (act.action === "click" && target) {
      // A listed choice is checked, not clicked. check() leaves a box that is
      // already on alone. A role widget has no check(), so it is clicked only
      // when it does not already say it is on. Anything else stays a click,
      // which is how Next and Continue still move.
      const nativeChoice = now.type === "radio" || now.type === "checkbox";
      const roleChoice = now.role === "radio" || now.role === "checkbox";
      const listedOn = act.ensureChecked && roleChoice
        ? await target.evaluate((el) => el.getAttribute("aria-checked") === "true").catch(() => false)
        : false;
      if (act.ensureChecked && !nativeChoice && !roleChoice) {
        note = "left blank";
        detail = "check blocked on a control that is not a choice";
      } else if (act.ensureChecked && nativeChoice) {
        detail = `check "${label.slice(0, 40)}"`;
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {}), target.check({ timeout: 6000 })]);
      } else if (listedOn) {
        detail = `check "${label.slice(0, 40)}"`;
      } else {
        detail = `click "${label.slice(0, 40)}"`;
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {}), target.click({ timeout: 6000 })]);
      }
    } else if (act.action === "type" && target) {
      const choice = now.type === "radio" || now.type === "checkbox" || now.role === "radio" || now.role === "checkbox";
      if (choice) {
        // fill() rejects a radio, and the fallback below would click it.
        // That click selects the choice. Leave it blank instead.
        note = "left blank";
        detail = "type blocked on a choice control";
      } else {
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
      }
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
