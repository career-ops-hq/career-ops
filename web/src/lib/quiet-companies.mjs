// Shaping for the "gone quiet" panel.
//
// Pure .mjs so the follow-ups view can import it and `node --test` can cover it.
//
// ── The line this panel must not cross ──────────────────────────────────────
//
// rejection-latency.mjs measures ELAPSED TIME and nothing else. Its own payload
// carries the sentence that says so:
//
//   "Elapsed-time observation only — not legal advice or a claim that the
//    employer did anything wrong."
//
// A panel headed "companies that ghosted you", listing employers next to a
// day count, converts that measurement into an accusation — about named third
// parties, in a tool whose output people paste into messages. The copy here
// stays on the observation ("no reply since…"), and the disclaimer travels with
// the list rather than being dropped as boilerplate.
//
// The blacklist row is likewise passed through as text to copy, never applied:
// AGENTS.md describes data/blacklist.md as opt-in and never auto-populated.

/**
 * @typedef {{company: string, role: string|null, days: number, lastDate: string|null,
 *            trackerNums: number[], reason: string|null, blacklistRow: string|null}} QuietCompany
 * @typedef {{available: boolean, reason: string|null, companies: QuietCompany[],
 *            checked: number, courtesyDays: number|null, disclaimer: string|null,
 *            warnings: string[]}} QuietModel
 */

/**
 * @param {{available?: boolean, reason?: string|null, data?: object|null}|null|undefined} payload
 * @param {number} [limit]
 * @returns {QuietModel}
 */
export function quietModel(payload, limit = 10) {
  const empty = {
    available: false,
    reason: typeof payload?.reason === "string" ? payload.reason : "unavailable",
    companies: [],
    checked: 0,
    courtesyDays: null,
    disclaimer: null,
    warnings: [],
  };
  if (!payload?.available || !payload.data) return empty;

  const d = payload.data;
  const meta = d.metadata ?? {};
  const flags = Array.isArray(d.flags) ? d.flags : [];

  const companies = flags
    .filter((f) => f && typeof f.company === "string" && f.company.trim() !== "")
    // Longest silence first: the ordering is the only prioritisation this panel
    // offers, and the core does not guarantee one.
    .slice()
    .sort((a, b) => num(b.daysSinceLastInterview) - num(a.daysSinceLastInterview))
    .slice(0, Math.max(1, Math.trunc(limit)))
    .map((f) => ({
      company: f.company,
      role: typeof f.role === "string" && f.role.trim() !== "" ? f.role : null,
      days: num(f.daysSinceLastInterview),
      lastDate: typeof f.lastInterviewDate === "string" ? f.lastInterviewDate : null,
      trackerNums: Array.isArray(f.trackerNums) ? f.trackerNums.filter((n) => Number.isFinite(n)) : [],
      reason: typeof f.reason === "string" ? f.reason : null,
      blacklistRow: typeof f.blacklistSuggestion === "string" ? f.blacklistSuggestion : null,
    }));

  return {
    available: true,
    reason: null,
    companies,
    checked: num(meta.companiesChecked),
    courtesyDays: Number.isFinite(meta.courtesyDays) ? meta.courtesyDays : null,
    // Carried, never inlined as a constant: if the core ever rewords or removes
    // it, the panel must follow rather than keep asserting the old sentence.
    disclaimer: typeof meta.disclaimer === "string" ? meta.disclaimer : null,
    warnings: Array.isArray(d.warnings) ? d.warnings.filter((w) => typeof w === "string") : [],
  };
}

/**
 * Whether the panel has something to say at all.
 *
 * A separate predicate because "nothing is quiet" and "the check could not run"
 * are different states, and only the first deserves a reassuring empty line.
 *
 * @param {QuietModel} model
 * @returns {boolean}
 */
export function checkRan(model) {
  return model.available;
}

function num(v) {
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}
