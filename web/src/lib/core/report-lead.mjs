// Which report section leads the page as the highlighted callout.
//
// This used to be section F, on the assumption that the core wrote
// "## F) Verdict". It does not: modes/oferta.md defines Block F as the
// INTERVIEW PLAN, and no `Verdict` block exists in the report contract. The
// result was that every report led with interview preparation — the block that
// only matters *after* a callback — while `## Recommendation`, the block that
// answers "should I apply?", sat collapsed in the depth-on-demand tier.
//
// Preference order, most decision-bearing first: Recommendation, then Verdict,
// then Risk Summary. `Verdict` is accepted even though the core does not emit it
// today, so a future contract change is picked up rather than silently ignored.
//
// Only `## Risk Summary` is actually specified by modes/oferta.md ("close the
// report body with a Risk Summary block"); `## Recommendation` is written by
// some reports without being in the contract. So on an established tracker most
// reports match nothing here and render with no callout at all. That is the
// intended outcome: the bug being fixed was a confident callout labelled
// "Verdict" over content that was not the verdict, and no callout is honest
// where a wrong one was not.
//
// Plain .mjs (not .ts) so the root test suite can import it with no build step
// and no `@/` alias loader, mirroring tracker-table.mjs.

const LEAD_PREFERENCE = [/^recommendation\b/i, /^verdict\b/i, /^risk summary\b/i];

// splitSections() leaves the author-letter ON the heading ("A) Role Summary")
// and reports the letter separately, so a lettered `## H) Recommendation` must be
// matched here or it falls through to Risk Summary or null.
//
// Any single letter, not the A-G the report contract documents: the corpus
// already carries `## H) Draft Application Answers`, so an A-G range is a list
// that reality has outgrown. What makes this safe is the required `)`, `.`, or
// `:` delimiter, not the narrow range — "A Recommendation Was Requested" has no
// delimiter and is left alone.
const AUTHOR_LETTER = /^\s*(?:Block\s+)?[A-Z][).:]\s*/i;

/** @param {unknown} heading */
function normalizeHeading(heading) {
  return String(heading ?? '')
    .trim()
    .replace(AUTHOR_LETTER, '')
    .trim();
}

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
    const hit = list.find((s) => pattern.test(normalizeHeading(s?.heading)));
    if (hit) return hit;
  }
  return null;
}
