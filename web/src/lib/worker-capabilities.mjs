// worker-capabilities.mjs — the set of web run kinds and their shell needs.
// Owns the policy both CLIs read: run kinds are a fact about the route's
// workers, not about Claude (#2507). Import this rather than hardcoding kind
// lists in route.ts or claude-invocation.mjs.

/** Every kind the /api/run route accepts (default: evaluate). */
export const KNOWN_KINDS = Object.freeze(["evaluate", "research", "pdf", "cover", "fix-portal"]);

/**
 * Kinds that must run real core scripts via a shell (reserve-report-num,
 * merge-tracker, generate-pdf, verify-portals, …). research stays read-only.
 * @param {string} kind
 * @returns {boolean}
 */
export function needsShell(kind) {
  return kind === "evaluate" || kind === "fix-portal" || kind === "pdf" || kind === "cover";
}
