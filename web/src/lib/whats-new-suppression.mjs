/**
 * Which tracker rows suppress their company from "new matches this week".
 *
 * The supply loop (api/whats-new) hides an offer when its company already appears
 * in data/applications.md, so the user is not shown employers they have already
 * assessed. Two canonical states do not mean that:
 *
 *   - Rejected  — the company's verdict on ONE role. It says nothing about the
 *                 employer's other openings, which are routinely different teams
 *                 with different requirements.
 *   - Discarded — the candidate's own pass on ONE role (wrong function, wrong
 *                 location, posting closed). Role-scoped, not employer-scoped.
 *
 * Every other canonical state (Evaluated, Applied, Responded, Interview, Offer,
 * Hired, SKIP) reflects either an assessment still in flight or a standing
 * decision, so those keep suppressing. See templates/states.yml for the list.
 */
const ROLE_SCOPED_OUTCOMES = /^\s*(rejected|discarded)\s*$/i;

/** True when a tracker row in this status should hide its company from "new". */
export function suppressesCompany(status) {
  return !ROLE_SCOPED_OUTCOMES.test(status || "");
}
