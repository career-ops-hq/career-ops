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
    return `No tailored CV was resolved for ${label}, so nothing will be attached. The employer form stays on this page until a file is attached.`;
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
