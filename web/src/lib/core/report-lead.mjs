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
// then Risk Summary.
//
// Only `## Risk Summary` is specified by modes/oferta.md ("close the report body
// with a Risk Summary block"). `## Recommendation` and `## Verdict` are both
// written by reports without being in the contract, and a report carrying only a
// `## Verdict` opens it with the actual call ("Do not apply. 3.3/5 sits below
// the 3.5 line"), which is why it is a candidate rather than a hypothetical.
//
// Most reports carry none of the three and so render with no callout at all.
// That is the intended outcome: the bug being fixed was a confident callout
// labelled "Verdict" over content that was not the verdict, and no callout is
// honest where a wrong one was not.
//
// Plain .mjs (not .ts) so the root test suite can import it with no build step
// and no `@/` alias loader, mirroring tracker-table.mjs.
//
// The author-letter prefix is stripped by report-sections.mjs's cleanHeading,
// not by a second regex here. splitSections() leaves the letter ON the heading
// ("A) Role Summary") and reports it separately, so a lettered
// `## H) Recommendation` has to be normalized before it can be matched — and
// #2324 is exactly the bug of two copies of that range drifting apart, so this
// file reads the same definition rather than restating it. cleanHeading also
// drops a trailing "(lead)"/"(verdict)"; the optional parenthetical below stays
// because it covers every other qualifier ("Risk Summary (detailed)").
import { cleanHeading } from '../report-sections.mjs';

// Each pattern matches the whole normalized heading, not a prefix of it. A
// prefix match promoted anything merely starting with a candidate word, so a
// section titled "Recommendation Was Requested" would have led the page.
//
// The two deliberate liberties are an optional plural and an optional trailing
// parenthetical: `## Recommendations` is the same block by another name, and the
// renderer already strips a trailing "(lead)"/"(verdict)" for display, so a
// qualifier in parentheses is an expected shape rather than an oddity.
//
// Each candidate spells its own plural rather than sharing an `s?` suffix. A
// shared suffix quietly covered `Recommendations` and `Verdicts` while missing
// `Risk Summaries`, so the helper advertised a rule it only kept for two of the
// three. No report in the corpus uses a plural today; the fault was the
// inconsistency, which is the kind of gap that reads as working.
const bounded = (...forms) => new RegExp(`^(?:${forms.join('|')})\\s*(?:\\([^)]*\\))?$`, 'i');

const LEAD_PREFERENCE = [
  bounded('recommendation', 'recommendations'),
  bounded('verdict', 'verdicts'),
  bounded('risk summary', 'risk summaries'),
];

/** @param {unknown} heading */
function normalizeHeading(heading) {
  return cleanHeading(String(heading ?? '').trim());
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
