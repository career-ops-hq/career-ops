// Shaping for the company evidence card.
//
// Pure .mjs so the report view can import it and `node --test` can cover it.
//
// ── The rule this module exists to hold ─────────────────────────────────────
//
// company-history.mjs distinguishes "the check ran and found nothing" from "the
// check never ran", and says why in its own comment:
//
//     It must still not claim `none-detected` — the check was skipped for it,
//     exactly as on the full card.
//     …Without the Set an aggregator would render as `none-detected`, which
//     claims a negative result from a check that never ran.
//
// A UI that renders every churn label as a reassuring line throws that
// distinction away, and "no repeat postings detected" shown to someone whose
// scan history was never loaded is a claim the data cannot support. So each
// label maps to an explicit `kind`: `finding`, `absence`, or `not-checked` —
// and only `finding` and `absence` may be phrased as conclusions.

/**
 * @typedef {"finding"|"absence"|"not-checked"} Kind
 * @typedef {{kind: Kind, headline: string, detail: string|null}} Verdict
 *
 * One tracker row behind a responsiveness verdict.
 *
 * TWO SHAPES, and the card has to read both. A responded fact carries
 * `outcome` and `date`; a SILENT one carries `appliedDate`, `silentDays`,
 * `status` and `followupsSent` and has neither. Rendering only the first pair
 * printed silent rows with an empty outcome and no date at all.
 *
 * Every field is optional because the shape is whatever company-history.mjs put
 * there, and the card renders what it finds rather than asserting a contract it
 * does not own.
 * @typedef {{num?: number|string, outcome?: string, date?: string, stale?: boolean, dateBasis?: string,
 *            appliedDate?: string, silentDays?: number, status?: string, followupsSent?: number}} ResponsivenessFact
 *
 * @typedef {{available: boolean, reason: string|null, company: string|null,
 *            responsiveness: Verdict|null, churn: Verdict|null,
 *            facts: ResponsivenessFact[], explanations: string[]}} CompanyCardModel
 */

/** Responsiveness labels the core emits, and what each is allowed to say. */
const RESPONSIVENESS = {
  "responded-before": {
    kind: "finding",
    headline: "They have replied to you before",
    detail: "At least one application here moved past Applied.",
  },
  "silent-on-you": {
    kind: "finding",
    headline: "No reply so far",
    detail: "Applications here have passed the courtesy window without an answer.",
  },
  mixed: {
    kind: "finding",
    headline: "Mixed — replied to some, not others",
    detail: null,
  },
  "no-history": {
    kind: "absence",
    headline: "No history with this company yet",
    detail: "Nothing here has reached a stage that would show a reply either way.",
  },
};

/** Churn labels. Two of these mean the check did not run. */
const CHURN = {
  // The one that actually says something. Omitting it made the card fall through
  // to "Not evaluated" exactly when the core HAD found re-listings — silent at
  // the only moment it had news.
  "reposts-detected": {
    kind: "finding",
    headline: "This role keeps being re-listed",
    detail: "The same posting has reappeared across scans, which can mean the role is not really open.",
  },
  "none-detected": {
    kind: "absence",
    headline: "No repeat postings found",
    detail: "Scan history was checked and this role has not been re-listed.",
  },
  "no-scan-data": {
    kind: "not-checked",
    headline: "Repeat postings not checked",
    detail: "No scan history is loaded, so this says nothing either way.",
  },
  "aggregator-not-evaluated": {
    kind: "not-checked",
    headline: "Repeat postings not checked",
    detail: "This is a job aggregator, where re-listing is normal and not a signal.",
  },
};

/**
 * Build the card model from the route's payload.
 *
 * @param {{available?: boolean, reason?: string|null, card?: object|null}|null|undefined} payload
 * @returns {CompanyCardModel}
 */
export function companyCardModel(payload) {
  const empty = {
    available: false,
    reason: typeof payload?.reason === "string" ? payload.reason : "unavailable",
    company: null,
    responsiveness: null,
    churn: null,
    facts: [],
    explanations: [],
  };
  if (!payload?.available || !payload.card) return empty;

  const card = payload.card;
  return {
    available: true,
    reason: null,
    company: typeof card.company === "string" ? card.company : null,
    responsiveness: verdictFor(RESPONSIVENESS, card.responsiveness?.label),
    churn: verdictFor(CHURN, card.postingChurn?.label),
    facts: Array.isArray(card.responsiveness?.facts) ? card.responsiveness.facts : [],
    explanations: Array.isArray(card.explanations) ? card.explanations.filter((e) => typeof e === "string") : [],
  };
}

/**
 * Map a label to its verdict, refusing to invent one for a label added later.
 *
 * An unknown label becomes `not-checked` rather than being dropped or guessed
 * at: a new label is a state this UI has not been taught to read, and silence
 * about it is safer than a phrasing that may be the opposite of what it means.
 *
 * @param {Record<string, Verdict>} table
 * @param {unknown} label
 * @returns {Verdict|null}
 */
export function verdictFor(table, label) {
  if (typeof label !== "string" || label === "") return null;
  const hit = table[label];
  if (hit) return hit;
  return {
    kind: "not-checked",
    headline: "Not evaluated",
    detail: `The core reported “${label}”, which this view does not recognise yet.`,
  };
}

/**
 * Whether a verdict may be phrased as a conclusion about the company.
 *
 * @param {Verdict|null} verdict
 * @returns {boolean}
 */
export function isConclusion(verdict) {
  return verdict?.kind === "finding" || verdict?.kind === "absence";
}

/**
 * One fact as a line of text, reading whichever shape it is.
 *
 * Returns null when there is nothing to say, so the caller drops the row rather
 * than rendering bullets of punctuation.
 *
 * @param {ResponsivenessFact} f
 * @returns {string|null}
 */
export function factLine(f) {
  if (!f || typeof f !== "object") return null;
  const bits = [];
  if (f.num !== undefined && f.num !== null && String(f.num).trim() !== "") bits.push(`#${String(f.num).trim()}`);

  // A silent fact has no outcome — its content is how long the silence has run,
  // and whether the user chased it.
  if (Number.isFinite(f.silentDays)) {
    bits.push(`no reply in ${Math.trunc(f.silentDays)} days`);
    if (typeof f.appliedDate === "string" && f.appliedDate.trim() !== "") bits.push(`applied ${f.appliedDate.trim()}`);
    if (Number.isFinite(f.followupsSent) && f.followupsSent > 0) {
      bits.push(`${Math.trunc(f.followupsSent)} follow-up${f.followupsSent === 1 ? "" : "s"} sent`);
    }
  } else {
    if (typeof f.outcome === "string" && f.outcome.trim() !== "") bits.push(f.outcome.trim());
    const date = typeof f.date === "string" && f.date.trim() !== "" ? f.date.trim() : null;
    if (date) bits.push(date);
  }

  if (f.stale === true) bits.push("stale");
  // A row that is only its own number tells the reader nothing they can use.
  return bits.length > 1 ? bits.join(" · ") : null;
}
