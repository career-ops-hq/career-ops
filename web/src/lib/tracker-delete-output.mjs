/**
 * Read the report a `tracker.mjs delete` run leaves behind out of its stderr.
 *
 * The script names the removed row's report in one of two lines:
 *
 *   dry-run  (report file would be orphaned: [42](../reports/042-beta.md))
 *   real     Note: report file may now be orphaned — [42](../reports/042-beta.md)
 *
 * The value is the tracker's Report CELL, a markdown link, so it ends in `)`.
 * The pattern this replaces stopped its capture at the first `)` and required
 * the dash to follow "orphaned" with no space, so it matched neither line and
 * the confirm dialog's "report file is left on disk" notice never showed.
 *
 * Each line is matched whole and by its own shape, so the trailing `)` of the
 * dry-run line is never confused with the one that closes the link.
 *
 * @param {string | undefined | null} stderr - Everything the script wrote to stderr.
 * @returns {string | null} The report's path as the tracker links it, without
 *   leading `../`; the raw cell when it is not a link; null when no report is named.
 */
export function parseOrphanReport(stderr) {
  for (const line of String(stderr ?? "").split(/\r?\n/)) {
    const cell =
      line.match(/^\(report file would be orphaned: (.*)\)\s*$/)?.[1] ??
      line.match(/^Note: report file may now be orphaned — (.*)$/)?.[1];
    if (cell === undefined) continue;
    const text = cell.trim();
    if (!text) return null;
    const link = text.match(/^\[[^\]]*\]\((.+)\)$/);
    return link ? link[1].trim().replace(/^(?:\.\.\/)+/, "") : text;
  }
  return null;
}
