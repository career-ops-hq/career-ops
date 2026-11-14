/**
 * handoff-gate.mjs — whether the employer window may open.
 *
 * The person reviews answers on the CareerOps page first. A required
 * sponsorship, work-authorization, or compensation question the profile can
 * answer must already have a value. A résumé field this page claimed to fill
 * must have a real file. Citizenship, gender, race, disability, and veteran
 * questions are not this gate's to answer.
 *
 * Plain .mjs so node --test can import it without Playwright.
 */
import { isResumeLabel } from "./resume-label.mjs";

const EEO_OR_STATUS =
  /\b(citizen|citizenship|nationality|gender|race|racial|ethnicity|ethnic|disability|disabled|veteran|permanent basis|permanent resident)\b/i;
const SALARY_HISTORY =
  /\b(salary history|compensation history|(?:current|previous|prior|last) (?:salary|compensation|pay))\b/i;
const SPONSORSHIP = /\b(sponsor|sponsorship|visa)\b/i;
const AUTHORIZATION =
  /\b(work authori[sz]ation|authori[sz]ed to work|legally authori[sz]ed|eligible to work)\b/i;
const COMPENSATION =
  /\b(salary|compensation|desired pay|pay expectation|expected pay|wage expectation)\b/i;

/**
 * @param {string | undefined} label
 * @returns {"sponsorship" | "authorization" | "compensation" | null}
 */
export function screeningKind(label) {
  const text = label || "";
  if (EEO_OR_STATUS.test(text) || SALARY_HISTORY.test(text)) return null;
  if (SPONSORSHIP.test(text)) return "sponsorship";
  if (AUTHORIZATION.test(text)) return "authorization";
  if (COMPENSATION.test(text)) return "compensation";
  return null;
}

const SCREENING_LEAD = {
  sponsorship: "Required sponsorship question is still empty",
  authorization: "Required work authorization question is still empty",
  compensation: "Required compensation question is still empty",
};

function screeningMessage(kind, label) {
  return `${SCREENING_LEAD[kind]} (${label}). Fill it on this page before the employer form opens.`;
}

function resumeMessage(label, cvAttached) {
  if (!cvAttached) {
    return `No tailored CV was resolved for ${label}, so nothing will be attached. Open the report in another tab and choose Generate tailored CV, then retry filling here. The employer form stays on this page until a file is attached.`;
  }
  return `The tailored CV did not attach to ${label}. The employer form stays on this page until that file is on the form.`;
}

/**
 * Copy for a file field on the review screen.
 *
 * @param {{ label?: string, cvAttached?: boolean }} input
 * @returns {{ claim: boolean, text: string }}
 */
export function resumeFieldNotice({ label, cvAttached = false } = {}) {
  if (!isResumeLabel(label)) {
    return { claim: false, text: "Attach this file yourself on the real form at the handoff." };
  }
  if (cvAttached) {
    return {
      claim: true,
      text: "Your tailored CV (PDF) will be attached automatically. You can swap it on the real form.",
    };
  }
  return { claim: false, text: "No tailored CV was resolved, so this file will not be attached." };
}

function blank(value) {
  return value == null || String(value).trim() === "";
}

/**
 * @param {{
 *   fields?: { id?: string, type?: string, label?: string, required?: boolean }[],
 *   answers?: Record<string, string>,
 *   cvAttached?: boolean,
 *   steps?: { fieldId?: string, ok?: boolean }[],
 *   unmetLabels?: string[],
 *   blankAnswersBlock?: boolean,
 * }} [input]
 * @returns {{ handoff: boolean, gaps: { level: "warn", code: string, message: string, field?: string }[] }}
 */
export function handoffDecision({
  fields = [],
  answers = {},
  cvAttached = false,
  steps = [],
  unmetLabels = [],
  blankAnswersBlock = true,
} = {}) {
  // verifyFill names empty fields by label. It does not send field ids, so one
  // unmet label holds every field that shares that label.
  const unmet = new Set(unmetLabels.filter((label) => typeof label === "string" && label));
  /** @type {{ level: "warn", code: string, message: string, field?: string }[]} */
  const gaps = [];

  for (const field of fields) {
    const label = field.label || "this field";
    const kind = screeningKind(field.label);
    if (field.required && kind) {
      const missingAnswer = blankAnswersBlock && blank(answers[field.id]);
      const missedOnForm = unmet.has(field.label || "");
      if (missingAnswer || missedOnForm) {
        gaps.push({
          level: "warn",
          code: "screening-empty",
          field: label,
          message: screeningMessage(kind, label),
        });
      }
    }

    if (field.type === "file" && isResumeLabel(field.label)) {
      const step = steps.find((item) => item.fieldId === field.id);
      const attached = !!cvAttached && step?.ok === true && !unmet.has(field.label || "");
      const claimed = !!cvAttached;
      const mustHaveFile = claimed || field.required === true;
      if (mustHaveFile && !attached) {
        gaps.push({
          level: "warn",
          code: "resume-missing",
          field: label,
          message: resumeMessage(label, !!cvAttached),
        });
      }
    }
  }

  return { handoff: gaps.length === 0, gaps };
}

const HANDOFF_GAP = new Set(["screening-empty", "resume-missing"]);

/**
 * A screening or résumé gap keeps the editor up. A warning such as an optional
 * résumé that failed to resolve does not.
 *
 * @param {{ code?: string } | null | undefined} gap
 */
export function gapHoldsEditor(gap) {
  return !!gap && HANDOFF_GAP.has(gap.code);
}

/**
 * Drop the empty-field warnings a retry asks about again. The element type
 * stays whatever the caller stored, so a list of apply issues comes back as
 * that same list.
 *
 * @template {{ code?: string }} T
 * @param {T[] | null | undefined} issues
 * @returns {T[]}
 */
export function withoutHandoffGaps(issues) {
  const list = Array.isArray(issues) ? issues : [];
  return list.filter((issue) => !HANDOFF_GAP.has(issue && issue.code));
}

/**
 * Append issues that are not already listed. An ai-filled note stays one
 * per list, so a retry does not stack copies. Two résumé gaps with different
 * messages both stay.
 *
 * @template {{ code?: string, message?: string }} T
 * @param {T[] | null | undefined} previous
 * @param {T[] | null | undefined} incoming
 * @returns {T[]}
 */
export function mergeIssues(previous, incoming) {
  const prev = Array.isArray(previous) ? previous : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const seenMessages = new Set(prev.map((issue) => issue && issue.message));
  const added = [];
  let hasAiFilled = prev.some((issue) => issue && issue.code === "ai-filled");
  for (const issue of next) {
    if (!issue || !issue.message) continue;
    if (seenMessages.has(issue.message)) continue;
    if (issue.code === "ai-filled" && hasAiFilled) continue;
    added.push(issue);
    seenMessages.add(issue.message);
    if (issue.code === "ai-filled") hasAiFilled = true;
  }
  return [...prev, ...added];
}

/**
 * The latest verify-after-fill list replaces earlier required-empty warnings.
 * A field that filled this time drops off. Other issues stay.
 *
 * @template {{ code?: string, message?: string }} T
 * @param {T[] | null | undefined} previous
 * @param {T[] | null | undefined} verified
 * @returns {T[]}
 */
export function replaceRequiredEmpty(previous, verified) {
  const kept = (Array.isArray(previous) ? previous : []).filter((issue) => !issue || issue.code !== "required-empty");
  const fresh = Array.isArray(verified) ? verified : [];
  const seen = new Set(kept.map((issue) => issue && issue.message));
  return [...kept, ...fresh.filter((issue) => issue && !seen.has(issue.message))];
}

/**
 * A fill body replaces the last handoff gaps. The caller leaves the previous
 * list alone when the request fails or has not returned.
 *
 * @template {{ code?: string, message?: string }} T
 * @param {T[] | null | undefined} previous
 * @param {T[] | null | undefined} incoming
 * @returns {T[]}
 */
export function issuesAfterFill(previous, incoming) {
  return replaceRequiredEmpty(withoutHandoffGaps(previous), incoming);
}

/**
 * An agent result replaces the last handoff gaps, then adds the gaps that
 * came back. `note` is the one ai-filled line, and only when the handoff finished.
 *
 * @template {{ code?: string, message?: string }} T
 * @param {T[] | null | undefined} previous
 * @param {{ gaps?: T[] | null, note?: string }} [result]
 * @returns {T[]}
 */
export function issuesAfterAgent(previous, { gaps, note } = {}) {
  const next = mergeIssues(withoutHandoffGaps(previous), gaps);
  if (!note) return next;
  return mergeIssues(next, [{ level: "info", code: "ai-filled", message: note }]);
}

/**
 * Map labeled drive answers onto field ids. A blank value stays blank so the
 * gate can see it.
 *
 * @param {{ id?: string, label?: string }[]} fields
 * @param {{ id?: string, label?: string, value?: string }[]} [labeled]
 */
export function answersByFieldId(fields, labeled = []) {
  /** @type {Record<string, string>} */
  const answers = {};
  for (const field of fields) {
    if (!field.id) continue;
    const hit = labeled.find((item) => item && item.id === field.id)
      ?? labeled.find((item) => item && !item.id && item.label && item.label === field.label);
    if (hit && hit.value != null) answers[field.id] = String(hit.value);
  }
  return answers;
}

function fieldLabel(field) {
  return String(field?.label || "").replace(/\s+/g, " ").trim();
}

/**
 * Names that belong to exactly one control. A shared name is not an identity.
 *
 * @param {{ nativeName?: string }[]} fields
 */
function uniqueNativeNames(fields) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const field of fields) {
    const name = field?.nativeName || "";
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([name]) => name));
}

/**
 * DOM id, or a name that identifies one control in this list.
 * A shared name such as phones[] is ignored: two controls can swap and
 * the keys still match.
 *
 * @param {{ nativeId?: string, nativeName?: string } | null | undefined} field
 * @param {Set<string>} uniqueNames
 */
function stableKey(field, uniqueNames) {
  if (field?.nativeId) return `id:${field.nativeId}`;
  const name = field?.nativeName || "";
  if (name && uniqueNames.has(name)) return `name:${name}`;
  return "";
}

/**
 * True when each positional id still points at the same control.
 * A shared label is ambiguous unless a DOM id, or a name that appears
 * once, still matches. Two controls can swap and the positional ids still
 * line up, so that list is not safe to reuse.
 *
 * @param {{ id?: string, label?: string, nativeId?: string, nativeName?: string }[]} before
 * @param {{ id?: string, label?: string, nativeId?: string, nativeName?: string }[]} after
 */
function sameFieldList(before, after) {
  if (before.length !== after.length) return false;
  const labels = before.map((field) => fieldLabel(field));
  const shared = labels.some((label, index) => label && labels.indexOf(label) !== index);
  const beforeNames = uniqueNativeNames(before);
  const afterNames = uniqueNativeNames(after);
  return before.every((field, index) => {
    const next = after[index];
    if (!field?.id || field.id !== next?.id || fieldLabel(field) !== fieldLabel(next)) return false;
    const left = stableKey(field, beforeNames);
    const right = stableKey(next, afterNames);
    if (left || right) return left === right;
    return !shared;
  });
}

/**
 * First field for each non-empty key, dropped when the key is shared.
 *
 * @template T
 * @param {T[]} fields
 * @param {(field: T) => string} keyOf
 */
function uniqueIndex(fields, keyOf) {
  /** @type {Map<string, { field: T, count: number }>} */
  const groups = new Map();
  for (const field of fields) {
    const key = keyOf(field);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { field, count: 1 });
  }
  /** @type {Map<string, T>} */
  const unique = new Map();
  for (const [key, group] of groups) {
    if (group.count === 1) unique.set(key, group.field);
  }
  return unique;
}

/**
 * @param {{ id?: string, label?: string } | null | undefined} item
 * @param {{ label?: string } | null | undefined} [source]
 */
function suppliedLabel(item, source) {
  return fieldLabel(source) || fieldLabel(item) || String(item?.id || "").trim() || "A field";
}

/**
 * Map drive answers onto the fields extracted after the agent moved the page.
 * A positional id is reused only when it still points at the same control.
 * A shared label needs a DOM id that still matches. Otherwise the answer
 * follows the control's DOM id, or a label that appears once. A shared label
 * with no DOM id stays unmatched, so it cannot land on a different question. A blank value stays blank. Each supplied answer that
 * is not placed is listed in `dropped`, by label, so the drive can keep the
 * banner off instead of treating it as checked.
 *
 * @param {{ id?: string, label?: string, nativeId?: string, nativeName?: string }[]} before
 * @param {{ id?: string, label?: string, nativeId?: string, nativeName?: string }[]} after
 * @param {{ id?: string, label?: string, value?: string }[]} [labeled]
 * @returns {{ answers: Record<string, string>, dropped: string[] }}
 */
export function answersForRefreshedFields(before, after, labeled = []) {
  const prior = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const items = Array.isArray(labeled) ? labeled : [];
  if (sameFieldList(prior, next)) {
    const answers = answersByFieldId(next, items);
    /** @type {Set<object>} */
    const used = new Set();
    for (const field of next) {
      if (!field?.id || !Object.prototype.hasOwnProperty.call(answers, field.id)) continue;
      const hit = items.find((item) => item && item.id === field.id)
        ?? items.find((item) => item && !item.id && item.label && item.label === field.label);
      if (hit) used.add(hit);
    }
    return {
      answers,
      dropped: items
        .filter((item) => item && item.value != null && !used.has(item))
        .map((item) => suppliedLabel(item)),
    };
  }

  const beforeById = new Map(prior.filter((field) => field?.id).map((field) => [field.id, field]));
  const afterByNativeId = uniqueIndex(next, (field) => field?.nativeId || "");
  const afterByNativeName = uniqueIndex(next, (field) => field?.nativeName || "");
  const afterByLabel = uniqueIndex(next, (field) => fieldLabel(field));
  /** @type {{ id: string, value: string, label: string }[]} */
  const picks = [];
  /** @type {string[]} */
  const dropped = [];
  for (const item of items) {
    if (!item || item.value == null) continue;
    const source = item.id ? beforeById.get(item.id) : undefined;
    const label = fieldLabel(source) || fieldLabel(item);
    let target;
    if (source?.nativeId) target = afterByNativeId.get(source.nativeId);
    if (!target && source?.nativeName && label) {
      const named = afterByNativeName.get(source.nativeName);
      if (named && fieldLabel(named) === label) target = named;
    }
    if (!target && label) target = afterByLabel.get(label);
    if (!target?.id) {
      dropped.push(suppliedLabel(item, source));
      continue;
    }
    picks.push({ id: target.id, value: String(item.value), label: suppliedLabel(item, source) });
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const pick of picks) counts.set(pick.id, (counts.get(pick.id) || 0) + 1);
  /** @type {Record<string, string>} */
  const answers = {};
  for (const pick of picks) {
    if (counts.get(pick.id) === 1) answers[pick.id] = pick.value;
    else dropped.push(pick.label);
  }
  return { answers, dropped };
}
