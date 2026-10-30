/**
 * scan-summary-marker.mjs — the machine-findable boundary where a scan's
 * summary begins (#3560).
 *
 * Every scanner ends a run with a human-readable summary, but until now the
 * only way to find where that summary starts was to hardcode the scanner's
 * banner text. Those banners are presentation strings: rewording one is a
 * cosmetic change here and a silent breakage in whatever slices the log —
 * the slice quietly returns the wrong region, or nothing, and the caller
 * cannot tell that from "the scan found nothing".
 *
 * They are also not safe to match loosely. `scan-ats-full.mjs` prints
 * `Reverse ATS scan — ...` at the START of a run and `Reverse ATS Scan — ...`
 * for the summary: a case-insensitive match on the obvious string swallows
 * the whole log, which for a full sweep is thousands of progress lines.
 *
 * So the banners stay exactly as they are, and one marker line goes above
 * them. The marker is the interface; the banner is decoration.
 *
 * MATCHING CONTRACT: consumers match the whole trimmed line against
 * SCAN_SUMMARY_MARKER — equality, not a prefix. Nothing is appended to it
 * (no scanner id, no counts), and adding anything later would be a breaking
 * change to be made knowingly, not a formatting tweak.
 *
 * Stream: the marker follows its scanner's summary. `scan-ats-full.mjs`
 * routes every human line to stderr under `--json` so that stdout carries
 * exactly one JSON object; passing that scanner's `log` as `emit` keeps the
 * marker on stderr with the summary it belongs to, and stdout uncontaminated.
 */

/**
 * The line printed immediately above a scan summary. Deliberately not a word
 * any scanner would print for another reason.
 */
export const SCAN_SUMMARY_MARKER = '::career-ops:scan-summary::';

/**
 * The marker plus the banner block that follows it.
 *
 * @param {string} title - Human banner title, e.g. 'Portal Scan'.
 * @param {string} date - Run date, already formatted (YYYY-MM-DD).
 * @returns {string[]} Lines to print in order. The leading '' preserves the
 *   blank line the scanners printed before their banner.
 */
export function scanSummaryHeaderLines(title, date) {
  const rule = '━'.repeat(45);
  return ['', SCAN_SUMMARY_MARKER, rule, `${title} — ${date}`, rule];
}

/**
 * Print the marker and banner block.
 *
 * @param {string} title - Human banner title, e.g. 'Portal Scan'.
 * @param {string} date - Run date, already formatted (YYYY-MM-DD).
 * @param {(line: string) => void} [emit] - Where to write; defaults to
 *   console.log. Pass the scanner's own logger when it redirects output
 *   (see the stream note above).
 */
export function printScanSummaryHeader(title, date, emit = console.log) {
  for (const line of scanSummaryHeaderLines(title, date)) emit(line);
}
