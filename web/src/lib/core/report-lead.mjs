// Which report section leads the page as the highlighted callout.
//
// This used to be section F, on the assumption that the core wrote
// "## F) Verdict". It does not: modes/oferta.md defines Block F as the
// INTERVIEW PLAN, and no `Verdict` block exists in the report contract. The
// result was that every report led with interview preparation — the block that
// only matters *after* a callback — while `## Recommendation`, the block that
// answers "should I apply?", sat collapsed in the depth-on-demand tier.
//
// Preference order, most decision-bearing first. `Verdict` is accepted even
// though the core does not currently emit it, so a future contract change is
// picked up rather than silently ignored.
//
// Plain .mjs (not .ts) so the root test suite can import it with no build step
// and no `@/` alias loader, mirroring tracker-table.mjs.

const LEAD_PREFERENCE = [/^verdict\b/i, /^recommendation\b/i, /^risk summary\b/i];

/**
 * The section to render as the lead callout, or null when the report carries no
 * decision-bearing block. Null rather than a fallback guess: leading with an
 * arbitrary section is what produced the original bug.
 *
 * @template {{heading?: string, letter?: string | null}} T
 * @param {T[]} sections
 * @returns {T | null}
 */
export function pickLeadSection(sections) {
  const list = Array.isArray(sections) ? sections : [];
  for (const pattern of LEAD_PREFERENCE) {
    const hit = list.find((s) => pattern.test(String(s?.heading ?? '').trim()));
    if (hit) return hit;
  }
  return null;
}
