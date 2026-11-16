export const NO_REPORT_EXPLANATION =
  "No report file for this row. Generate tailored CV and Apply checklist stay off until an evaluation exists.";

/**
 * @param {boolean} hasReport
 * @returns {{ generateCv: boolean, checklist: boolean, explanation: string | null }}
 */
export function reportSpendActions(hasReport) {
  if (hasReport) return { generateCv: true, checklist: true, explanation: null };
  return { generateCv: false, checklist: false, explanation: NO_REPORT_EXPLANATION };
}
