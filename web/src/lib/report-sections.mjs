/**
 * report-sections.mjs — splitting a report body into its author-lettered
 * sections, and cleaning those headings for display.
 *
 * Plain .mjs (same pattern as clean-chips.mjs) so test-report-sections.mjs can
 * import it directly under Node, and so the two places that used to hard-code
 * the author-letter range can no longer drift apart: they were written as
 * `[A-G]` in report-view.tsx, which silently mis-handled `## H) Draft
 * Application Answers` — the heading rendered with its letter still attached
 * while every other section rendered clean, and splitSections reported
 * `letter: null` for it (#2324).
 *
 * The range is now any single letter. The `)` / `.` / `:` delimiter is what
 * keeps this from eating ordinary prose ("A Recommendation Was Requested"),
 * not the narrowness of the range — so widening it costs no safety, and a
 * block added past H is handled the day the core writes it.
 */

/**
 * Strips the prefix for display. A BARE letter needs a real delimiter, never a
 * bare space, or ordinary prose loses its first word ("A Recommendation Was
 * Requested" → "Recommendation Was Requested").
 *
 * After `Block` the whitespace form is allowed, because the word itself is the
 * disambiguator: "## Block A — Role Summary" (oferta.md:47) is unmistakably a
 * lettered heading. HEADING_LETTER below already reads that grammar as section
 * A, so leaving the prefix in the rendered heading made this file classify a
 * heading one way and display it another (CodeRabbit review).
 *
 * The separator is a RUN of dashes, not one character: modes/ja/kyujin.md and
 * modes/hi/naukri.md write the ASCII "## Block A -- Role Summary", which left a
 * stray "- " on every block of every report those modes produce.
 */
const HEADING_PREFIX = /^\s*(?:Block\s+([A-Z])(?:[).:]\s*|\s+(?:[—–-]+\s*)?)|([A-Z])[).:]\s*)/i;

/**
 * Reads the letter. A bare letter needs a delimiter, exactly like the display
 * form above — otherwise "A Recommendation Was Requested" is read as section A
 * and ReportView expands ordinary prose as if it were Block A.
 *
 * The whitespace form is kept for the spelled-out grammar only: oferta.md
 * writes "## Block A — Role Summary", where nothing follows the letter but a
 * space. Requiring a delimiter there would lose the F verdict callout and the
 * A/B expansion on those reports.
 */
const HEADING_LETTER = /^(?:Block\s+([A-Z])(?:[).:]|\s)|([A-Z])[).:])/i;

/**
 * @typedef {{ heading: string, letter: string | null, content: string }} Section
 */

/**
 * Display form of a section heading: author-letter prefix and the trailing
 * "(lead)" / "(verdict)" marker removed. Falls back to the original when
 * stripping would leave nothing.
 * @param {string} h
 * @returns {string}
 */
export function cleanHeading(h) {
  const stripped = h
    .replace(HEADING_PREFIX, "")
    .replace(/\s*\((?:lead|verdict)\)\s*$/i, "")
    .trim();
  return stripped || h.trim();
}

/**
 * The author letter of a heading, uppercased, or null when it carries none.
 * @param {string} heading
 * @returns {string | null}
 */
export function authorLetter(heading) {
  const match = heading.match(HEADING_LETTER);
  return (match?.[1] ?? match?.[2])?.toUpperCase() ?? null;
}

/**
 * Split a report body on `## ` headings. Everything before the first one is
 * the intro.
 * @param {string} body
 * @returns {{ intro: string, sections: Section[] }}
 */
export function splitSections(body) {
  /** @type {string[]} */
  const intro = [];
  /** @type {Section[]} */
  const sections = [];
  /** @type {{ heading: string, letter: string | null, lines: string[] } | null} */
  let cur = null;
  for (const line of body.split("\n")) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      if (cur) sections.push({ heading: cur.heading, letter: cur.letter, content: cur.lines.join("\n").trim() });
      const heading = h[1].trim();
      cur = { heading, letter: authorLetter(heading), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (cur) sections.push({ heading: cur.heading, letter: cur.letter, content: cur.lines.join("\n").trim() });
  return { intro: intro.join("\n").trim(), sections };
}
