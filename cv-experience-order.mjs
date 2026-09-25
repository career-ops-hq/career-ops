// cv-experience-order.mjs — reverse-chronological guard for rendered CVs.
//
// Split out of generate-pdf.mjs (which already sits near the repo's practical
// file-size ceiling) following the existing *-core.mjs convention used by
// liveness-core.mjs and cv-sections-core.mjs.

const MONTHS = new Map([
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6],
  ['jul', 7], ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
]);
// Any element whose class list includes job-period: template packs may change
// tag names inside the ENTRY zone of their experience partial (the ATS pack
// renders the period in a <div>, the default pack in a <span>).
const JOB_PERIOD_RE = /<([a-z][a-z0-9]*)\b[^>]*?\sclass="(?:[^"\s]+\s+)*job-period(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/**
 * Parse the START of a rendered job-period string.
 *
 * Only the start date matters: reverse-chronological ordering is defined by
 * when each role began. Returns null when no year is present, and a null month
 * when the period has none or names it in a language MONTHS does not know
 * ("Ago 2021", "Dez 2022"), so unparseable parts are skipped rather than
 * guessed at — the same "don't penalize missing data" discipline the location
 * and country filters use.
 *
 * @param {string} period - e.g. "Jan 2021 - Apr 2022", "2005 - 2008".
 * @returns {{ year: number, month: number|null }|null} null when no year is found.
 */
export function parseExperienceStart(period) {
  if (typeof period !== 'string') return null;
  const text = period.replace(/&[a-z]+;/gi, ' ').trim();
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (!year) return null;
  const before = text.slice(0, year.index);
  const month = before.match(/\b([a-z]{3})[a-z]*\.?\s*$/i);
  return {
    year: Number(year[0]),
    month: month ? (MONTHS.get(month[1].toLowerCase()) ?? null) : null,
  };
}

/**
 * Whether role `a` provably starts later than role `b`: a later year, or the
 * same year with both months known. An unknown month never decides.
 */
function startsLater(a, b) {
  if (a.year !== b.year) return a.year > b.year;
  return a.month !== null && b.month !== null && a.month > b.month;
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
    // Strip tags to a fixed point: one pass can leave text that re-forms a
    // tag (`<scr<b>ipt>` -> `<script>`).
    let text = match[2];
    let prev;
    do { prev = text; text = text.replace(/<[^>]*>/g, ''); } while (text !== prev);
    const raw = text.trim();
    const start = parseExperienceStart(raw);
    if (start !== null) entries.push({ raw, start });
  }
  if (entries.length < 2) return;

  for (let i = 1; i < entries.length; i++) {
    if (startsLater(entries[i].start, entries[i - 1].start)) {
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
