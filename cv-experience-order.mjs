// cv-experience-order.mjs — reverse-chronological guard for rendered CVs.
//
// Split out of generate-pdf.mjs (which already sits near the repo's practical
// file-size ceiling) following the existing *-core.mjs convention used by
// liveness-core.mjs and cv-sections-core.mjs.

const MONTHS = new Map([
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6],
  ['jul', 7], ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
]);
const JOB_PERIOD_RE = /<span class="job-period">([\s\S]*?)<\/span>/g;

/**
 * Parse the START of a rendered job-period string into a sortable integer.
 *
 * Only the start date matters: reverse-chronological ordering is defined by
 * when each role began. Returns null when no year is present, so unparseable
 * entries are skipped rather than guessed at — the same "don't penalize
 * missing data" discipline the location and country filters use.
 *
 * @param {string} period - e.g. "Jan 2021 - Apr 2022", "2005 - 2008".
 * @returns {number|null} year * 12 + month, or null when no year is found.
 */
export function parseExperienceStart(period) {
  if (typeof period !== 'string') return null;
  const text = period.replace(/&[a-z]+;/gi, ' ').trim();
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (!year) return null;
  const before = text.slice(0, year.index);
  const month = before.match(/\b([a-z]{3})[a-z]*\.?\s*$/i);
  const monthNum = month ? (MONTHS.get(month[1].toLowerCase()) ?? 1) : 1;
  return Number(year[0]) * 12 + monthNum;
}

/**
 * Enforce reverse-chronological ordering of Work Experience entries.
 *
 * Agents tailoring a CV toward a JD are tempted to promote "the most relevant
 * role" to the top. That is a functional-resume technique and it backfires:
 * it buries the candidate's most recent senior title, and both ATS parsers and
 * human recruiters expect newest-first, so deviation reads as concealment.
 * Tailor via the summary, the competencies block, and bullet selection within
 * each role instead — never via ordering.
 *
 * @param {string} html - Rendered CV HTML.
 * @param {{ allowNonChronological?: boolean }} [options] - When set, downgrades
 *   a detected inversion from a thrown error to a console warning, for the rare
 *   deliberately non-chronological CV.
 * @returns {void}
 */
export function validateCvExperienceOrder(html, { allowNonChronological = false } = {}) {
  if (typeof html !== 'string') return;

  const entries = [];
  for (const match of html.matchAll(JOB_PERIOD_RE)) {
    const raw = match[1].replace(/<[^>]*>/g, '').trim();
    const start = parseExperienceStart(raw);
    if (start !== null) entries.push({ raw, start });
  }
  if (entries.length < 2) return;

  for (let i = 1; i < entries.length; i++) {
    if (entries[i].start > entries[i - 1].start) {
      const order = entries.map(e => e.raw).join(' -> ');
      const message =
        `CV work experience is not in reverse-chronological order: "${entries[i].raw}" ` +
        `appears after "${entries[i - 1].raw}" but starts later. Rendered order: ${order}. ` +
        `Tailor via the summary, competencies, and bullet selection — not by reordering roles.`;
      if (allowNonChronological) {
        console.warn(`⚠️  ${message} (proceeding — --allow-nonchronological set)`);
        return;
      }
      throw new Error(message);
    }
  }
}
