/**
 * score-action.mjs — one score-to-action table.
 *
 * Mirror of lib/score-action.mjs. The parity test fails if the two disagree.
 * Full evaluation, triage, inbox rank, and the PDF gate read the root copy.
 * A profile may raise the triage pass line or the PDF gate.
 * It does not add a second scale.
 */

export const SCORE_MIN = 0;
export const SCORE_MAX = 5;

export const SCORE_BANDS = Object.freeze([
  Object.freeze({ id: 'strong_apply', label: 'Strong apply', min: 4.5, decision: 'Apply' }),
  Object.freeze({ id: 'apply', label: 'Apply', min: 4.0, decision: 'Apply' }),
  Object.freeze({ id: 'maybe', label: 'Maybe', min: 3.0, decision: 'Consider' }),
  Object.freeze({ id: 'skip', label: 'Skip', min: SCORE_MIN, decision: 'Skip' }),
]);

const bandById = (id) => {
  const found = SCORE_BANDS.find((band) => band.id === id);
  if (!found) throw new Error(`unknown score band ${id}`);
  return found;
};

/** Inclusive floor of the Apply band. Below this, recommend against applying. */
export const APPLY_MIN = bandById('apply').min;

/** Inclusive floor of the Strong apply band. */
export const STRONG_APPLY_MIN = bandById('strong_apply').min;

/** Inclusive floor of the Maybe band. Below this, the action is Skip. */
export const MAYBE_MIN = bandById('maybe').min;

/**
 * Inside Maybe, a score at or above this still gets a full A-G evaluation.
 * `config/profile.yml` → `pipeline.triage_threshold` overrides it.
 */
export const TRIAGE_PASS_MIN = 3.5;

/**
 * Default for `auto_pdf_score_threshold`. Same number as the Maybe floor.
 * A profile key overrides it, including 0 (a PDF for every score).
 */
export const PDF_GATE_DEFAULT = MAYBE_MIN;

function finiteScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score;
}

/**
 * @param {number} score
 * @returns {{ id: string, label: string, min: number, decision: string } | null}
 */
export function bandForScore(score) {
  const n = finiteScore(score);
  if (n === null || n < SCORE_MIN || n > SCORE_MAX) return null;
  for (const band of SCORE_BANDS) {
    if (n >= band.min) return band;
  }
  return null;
}

/**
 * The Machine Summary `final_decision` for this score.
 * A hard stop forces Skip. A suspicious posting forces Research first.
 * Neither changes the 1-5 number. The caller keeps that number as-is.
 * @param {number} score
 * @param {{ hardStop?: boolean, suspicious?: boolean }} [flags]
 * @returns {'Apply' | 'Consider' | 'Research first' | 'Skip' | null}
 */
export function recommendationFor(score, { hardStop = false, suspicious = false } = {}) {
  const band = bandForScore(score);
  if (!band) return null;
  if (hardStop) return 'Skip';
  if (suspicious) return 'Research first';
  return band.decision;
}

/**
 * Triage verdict for a score. `passMin` is the profile override when set.
 * The marginal floor stays the Maybe floor, so a raised pass line widens
 * MARGINAL instead of inventing a new band.
 * @param {number} score
 * @param {number} [passMin]
 * @returns {'PASS' | 'MARGINAL' | 'FAIL' | null}
 */
export function triageVerdict(score, passMin = TRIAGE_PASS_MIN) {
  const n = finiteScore(score);
  if (n === null || n < SCORE_MIN || n > SCORE_MAX) return null;
  const line = Number.isFinite(Number(passMin)) ? Number(passMin) : TRIAGE_PASS_MIN;
  if (n >= line) return 'PASS';
  if (n >= MAYBE_MIN) return 'MARGINAL';
  return 'FAIL';
}

/**
 * Whether the PDF gate writes a PDF. `threshold` is the resolved
 * `auto_pdf_score_threshold`, or `PDF_GATE_DEFAULT` when the key is absent.
 * @param {number} score
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function pdfGateAllows(score, threshold = PDF_GATE_DEFAULT) {
  const n = finiteScore(score);
  const line = Number(threshold);
  if (n === null || !Number.isFinite(line)) return false;
  return n >= line;
}
