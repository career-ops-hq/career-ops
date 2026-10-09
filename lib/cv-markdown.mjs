/**
 * lib/cv-markdown.mjs — read cv.md's structure through Pandoc-flavored
 * Markdown (#4879).
 *
 * cv-title-check.mjs, verify-cv-structure.mjs and jd-skill-gap.mjs each find
 * cv.md's sections and entries with regexes. Those regexes were written
 * against examples/cv-example.md, and a cv.md converted from a Word file with
 * Pandoc carries the same content in a different shape:
 *
 *   ## **[Professional Experience]{.smallcaps}**
 *
 *   ### **Acme Health, Inc.** --- New York, NY (Remote)
 *
 *   **Senior Director, Platform Engineering**\
 *   **09/2021 -- Present**
 *
 * Every check read that as "no Experience section" and degraded without a
 * word: cv-title-check compared 0 entries and still printed ✅. This module is
 * the one place that knows how to see through that shape, so the three checks
 * cannot drift apart again.
 *
 * Normalization is deliberately split in two:
 *   - normalizePandocLine() keeps structure: it drops hard breaks, unwraps
 *     `[text]{.class}` spans and turns Pandoc's `---` / `--` into the em / en
 *     dash they render as, but leaves `**bold**` and backslash escapes alone,
 *     so a caller can still ask "is this whole line bold?".
 *   - toPlainText() is for a value the caller has already located (a heading,
 *     a title, a dates line): it removes emphasis markers and unescapes.
 * Unescaping last matters: `\*\*` is a literal pair of asterisks, and turning
 * it into `**` before the bold test would invent emphasis that isn't there.
 *
 * Imports nothing, so doctor.mjs can use it without pulling in a check.
 */

// A whole line of three or more `-`, `*` or `_` is a thematic break (or YAML
// front matter), and a line starting with `|` is a table row. Neither is prose
// Pandoc would have smartened, so their dashes are left alone.
const THEMATIC_BREAK_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_ROW_RE = /^\s*\|/;

/**
 * Normalize one line of Pandoc Markdown without losing its structure.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizePandocLine(line) {
  let s = String(line ?? '').replace(/\r$/, '');
  // Hard line break: a single trailing backslash. `\\` at the end is an
  // escaped literal backslash, not a break.
  s = s.replace(/(?<!\\)\\\s*$/, '');
  // Bracketed span with attributes: `[Experience]{.smallcaps}` → `Experience`.
  s = s.replace(/\[([^\]\n]*)\]\{[^}\n]*\}/g, '$1');
  if (!THEMATIC_BREAK_RE.test(s) && !TABLE_ROW_RE.test(s)) {
    // Pandoc's smart typography: `---` is an em dash, `--` an en dash.
    s = s.replace(/(?<!-)---(?!-)/g, '—').replace(/(?<!-)--(?!-)/g, '–');
  }
  return s;
}

/**
 * Plain text of an already-located value: emphasis markers removed, backslash
 * escapes (`\|`, `\$`, `\*`, ...) resolved, whitespace collapsed.
 *
 * @param {string} text
 * @returns {string}
 */
export function toPlainText(text) {
  return String(text ?? '')
    .replace(/(?<!\\)(\*\*|__)/g, '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The plain text of an ATX heading of exactly `level`, or null when `line` is
 * not one. Pandoc's trailing attribute block (`{#experience .unnumbered}`) and
 * optional closing hashes are dropped.
 *
 * @param {string} line a line already passed through normalizePandocLine()
 * @param {number} level
 * @returns {string|null}
 */
export function headingText(line, level) {
  const m = String(line ?? '').match(new RegExp(`^#{${level}}\\s+(.+?)\\s*$`));
  if (!m) return null;
  const text = m[1]
    .replace(/\s*\{[^}]*\}\s*$/, '')
    .replace(/\s+#+\s*$/, '');
  return toPlainText(text);
}

/**
 * The plain text of a line that is bold from end to end (`**Job Title**`), or
 * null. A line that is only partly bold (`**Title** · 2020`) is not a title
 * line.
 *
 * @param {string} line a line already passed through normalizePandocLine()
 * @returns {string|null}
 */
export function boldLineText(line) {
  const m = String(line ?? '').match(/^(\*\*|__)(.+?)\1\s*$/);
  return m ? toPlainText(m[2]) : null;
}

// The Experience section names the checks accept. Matched against the plain
// heading text, so `## **[Professional Experience]{.smallcaps}**` qualifies.
const EXPERIENCE_HEADING_RE = /^(?:(?:work|professional)\s+)?experience$|^(?:employment|work)\s+history$/i;

/** Human-readable list of the accepted names, for warnings and usage text. */
export const EXPERIENCE_HEADING_NAMES = [
  'Experience', 'Work Experience', 'Professional Experience', 'Employment History', 'Work History',
];

/**
 * @param {string} text plain heading text
 * @returns {boolean}
 */
export function isExperienceHeading(text) {
  return EXPERIENCE_HEADING_RE.test(String(text ?? '').trim());
}

/**
 * Every recognized `## Experience`-style section of cv.md, as arrays of
 * normalized lines (heading excluded). A section runs to the next level-2
 * heading; `###` entries and level-1 headings do not end it.
 *
 * @param {string} cvText raw cv.md content
 * @returns {string[][]}
 */
export function findExperienceSections(cvText) {
  const lines = String(cvText ?? '').replace(/\r\n/g, '\n').split('\n').map(normalizePandocLine);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const h2 = headingText(line, 2);
    if (h2 !== null) {
      current = isExperienceHeading(h2) ? [] : null;
      if (current) sections.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  return sections;
}
