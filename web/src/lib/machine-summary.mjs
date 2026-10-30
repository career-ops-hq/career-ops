import * as yaml from "js-yaml";

/**
 * @typedef {"critical"|"high"|"meaningful"|"preferred"|"low_signal"} Importance
 * @typedef {{ requirement: string, importance: Importance, match: string }} Requirement
 * @typedef {{
 *   decision: string,
 *   strengths: string[],
 *   hardStops: string[],
 *   softGaps: string[],
 *   requirements: Requirement[],
 *   confidenceGaps: string[],
 *   unknownEvidence: string[],
 * }} MachineSummary
 * @typedef {{ text: string, importance: Importance | null }} Lever
 * @typedef {{ holding: Lever[], close: Lever[], verify: string[], strengths: string[] }} ScoreLevers
 */

const IMPORTANCE_RANK = { critical: 0, high: 1, meaningful: 2, preferred: 3, low_signal: 4 };

const EVIDENCE_LABEL = {
  cv_match: "CV match",
  north_star: "North Star alignment",
  compensation: "Compensation",
  culture: "Culture",
  red_flags: "Red flags",
};

const FENCE = /##\s*Machine Summary\s*\n+```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i;

const strings = (v) => (Array.isArray(v) ? v.map((s) => String(s ?? "").trim()).filter(Boolean) : []);

/**
 * The report's Machine Summary, or null when the report has none or its YAML
 * does not parse. Older reports predate the block.
 * @param {string} report
 * @returns {MachineSummary | null}
 */
export function readMachineSummary(report) {
  const fence = String(report ?? "").match(FENCE)?.[1];
  if (!fence) return null;
  let raw;
  try {
    raw = yaml.load(fence);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const evidence = raw.score_evidence && typeof raw.score_evidence === "object" ? raw.score_evidence : {};
  return {
    decision: String(raw.final_decision ?? "").trim(),
    strengths: strings(raw.top_strengths),
    hardStops: strings(raw.hard_stops),
    softGaps: strings(raw.soft_gaps),
    requirements: (Array.isArray(raw.requirement_importance) ? raw.requirement_importance : [])
      .filter((r) => r && String(r.requirement ?? "").trim() && Object.hasOwn(IMPORTANCE_RANK, String(r.importance)))
      .map((r) => ({
        requirement: String(r.requirement).trim(),
        importance: /** @type {Importance} */ (String(r.importance)),
        match: String(r.match ?? "").trim(),
      })),
    confidenceGaps: strings(raw.confidence_gaps),
    unknownEvidence: Object.entries(EVIDENCE_LABEL)
      .filter(([key]) => evidence[key] === "unknown")
      .map(([, label]) => label),
  };
}

/** @param {Requirement[]} rows @param {string} match */
function byImportance(rows, match) {
  return rows
    .filter((r) => r.match === match && IMPORTANCE_RANK[r.importance] <= IMPORTANCE_RANK.meaningful)
    .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance])
    .map((r) => ({ text: r.requirement, importance: r.importance }));
}

/**
 * What holds a score down, what is a near miss, and what to confirm before
 * trusting it. Preferred and low-signal requirements are left out because
 * they do not move the score.
 * @param {MachineSummary} s
 * @returns {ScoreLevers}
 */
export function scoreLevers(s) {
  const partial = byImportance(s.requirements, "partial");
  const listed = new Set(partial.map((r) => r.text.toLowerCase()));
  return {
    holding: [...s.hardStops.map((text) => ({ text, importance: null })), ...byImportance(s.requirements, "missing")],
    close: [
      ...partial,
      ...[...new Set(s.softGaps)].filter((text) => !listed.has(text.toLowerCase())).map((text) => ({ text, importance: null })),
    ],
    verify: [...s.confidenceGaps, ...s.unknownEvidence.map((label) => `${label} evidence is unknown`)],
    strengths: s.strengths,
  };
}

/**
 * @typedef {{ decision: string, plus: string | null, minus: string | null }} CardReason
 */

/**
 * The one-line reason a Today card shows: the evaluator's call, the strongest
 * match, and the biggest thing holding the score down.
 * @param {string} report
 * @returns {CardReason | null}
 */
export function cardReason(report) {
  const s = readMachineSummary(report);
  if (!s) return null;
  const { holding, close } = scoreLevers(s);
  const reason = { decision: s.decision, plus: s.strengths[0] ?? null, minus: (holding[0] ?? close[0])?.text ?? null };
  return reason.decision || reason.plus || reason.minus ? reason : null;
}

/**
 * @typedef {{ requirement: string, importance: Importance, match: string, question: string }} PrepQuestion
 */

const QUESTION_BY_MATCH = {
  strong: (r) => `Walk me through your strongest example of ${r}. What was the outcome?`,
  partial: (r) => `Where have you used ${r}, and how deep did you go?`,
  missing: (r) => `The role asks for ${r}. How would you close that gap?`,
};

/**
 * Likely screening questions, one per important requirement, most important
 * first. A requirement listed twice keeps only its most important entry. The match verdict picks the question: proof for a strong match,
 * depth for a partial one, a gap plan for a missing one.
 * @param {MachineSummary} s
 * @param {number} [limit]
 * @returns {PrepQuestion[]}
 */
export function prepQuestions(s, limit = 6) {
  return s.requirements
    .filter((r) => Object.hasOwn(QUESTION_BY_MATCH, r.match) && IMPORTANCE_RANK[r.importance] <= IMPORTANCE_RANK.meaningful)
    .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance])
    .filter((r, i, all) => all.findIndex((o) => o.requirement === r.requirement) === i)
    .slice(0, limit)
    .map((r) => ({ ...r, question: QUESTION_BY_MATCH[r.match](r.requirement) }));
}
