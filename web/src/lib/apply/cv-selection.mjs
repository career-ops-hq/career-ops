/** Return the report number referenced by a tracker report cell, e.g.
 *  "[010](../reports/010-decagon-2026-07-13.md)" -> 10. Anchored on the
 *  markdown-link form specifically (mirrors reportNumFromCell in
 *  web/src/lib/format.ts) rather than the first digit run anywhere in the
 *  cell: this number selects which tailored CV gets attached to a real
 *  application, so a leading number in prose before the link (a note, a
 *  date) must never be mistaken for the report id — a wrong CV attached
 *  silently is worse than no CV found. */
export function reportNumberFromCell(cell) {
  const match = /\[(\d+)\]/.exec(String(cell ?? ""));
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Resolve the exact PDF path recorded for a report in pdf-index.tsv. */
export function pdfPathForReport(indexText, reportNumber) {
  if (!Number.isInteger(reportNumber)) return null;
  for (const line of String(indexText ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const columns = line.split("\t");
    const indexedReport = columns[0]?.trim() ?? "";
    if (/^\d+$/.test(indexedReport) && Number(indexedReport) === reportNumber) {
      const pdf = columns[1]?.trim();
      return pdf || null;
    }
  }
  return null;
}
