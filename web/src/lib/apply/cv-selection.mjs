/** Return the report number referenced by a tracker report cell, e.g.
 *  "[010](../reports/010-decagon-2026-07-13.md)" -> 10. Requires the full
 *  inline-link form — the label AND its "(" destination opener, not just a
 *  bracketed number — so prose like "see [010] before [011](...)" can't be
 *  mistaken for a link and resolve to the wrong report: this number selects
 *  which tailored CV gets attached to a real application, and a wrong CV
 *  attached silently is worse than no CV found. */
export function reportNumberFromCell(cell) {
  const match = /\[(\d+)\]\(/.exec(String(cell ?? ""));
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Resolve the exact CV PDF path recorded for a report in pdf-index.tsv.
 *  A report can hold both a CV and a cover-letter row (#3967); the apply path
 *  wants the CV, so cover rows are skipped and a missing kind column (column 6)
 *  reads as "cv" to keep legacy manifests working. Selecting by kind rather than
 *  first-or-last match keeps this reader agreeing with find.mjs regardless of
 *  which artifact was generated first — a wrong CV attached silently is worse
 *  than no CV found. */
export function pdfIndexEntryForReport(indexText, reportNumber) {
  if (!Number.isInteger(reportNumber)) return { found: false, path: null };
  for (const line of String(indexText ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const columns = line.split("\t");
    const indexedReport = columns[0]?.trim() ?? "";
    if (!/^\d+$/.test(indexedReport) || Number(indexedReport) !== reportNumber) continue;
    if ((columns[5]?.trim() ?? "") === "cover") continue;
    const pdf = columns[1]?.trim();
    return { found: true, path: pdf || null };
  }
  return { found: false, path: null };
}

/** Resolve the exact PDF path recorded for a report in pdf-index.tsv. */
export function pdfPathForReport(indexText, reportNumber) {
  const entry = pdfIndexEntryForReport(indexText, reportNumber);
  return entry.found ? entry.path : null;
}
