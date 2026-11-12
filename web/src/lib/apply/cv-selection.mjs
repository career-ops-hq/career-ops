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

function untaggedArtifactKind(pdfPath) {
  const base = String(pdfPath ?? "").split(/[/\\]/).pop() ?? "";
  const name = base.toLowerCase().replace(/\.[^.]*$/, "");
  if (name.startsWith("cv-")) return "cv";
  if (/^cover([-_]|$)/.test(name) || /[-_]cover$/.test(name)) return "cover";
  return "cv";
}

/**
 * Parse lines from pdf-index.tsv into structured entries.
 *
 * Each row consists of tab-separated fields:
 * [0] report number
 * [1] relative pdf path
 * [2] html path (optional)
 * [3] format (e.g. "letter", "a4")
 * [4] date (YYYY-MM-DD)
 * [5] kind ("cv" | "cover" | custom)
 *
 * A blank kind stays a CV, so a legacy row from before the column is not
 * dropped (#3959). A blank kind whose file is named as a cover letter is a
 * cover, using the same filename rule as resolveArtifactKind. A declared
 * cv or cover wins over the filename.
 */
export function parsePdfManifestRows(indexText) {
  const rows = [];
  for (const line of String(indexText ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const columns = line.split("\t");
    const reportId = columns[0]?.trim() ?? "";
    const pdf = columns[1]?.trim() ?? "";
    const html = columns[2]?.trim() ?? "";
    const format = columns[3]?.trim() ?? "";
    const date = columns[4]?.trim() ?? "";
    const rawKind = (columns[5] ?? "").trim().toLowerCase();

    let kind = "unknown";
    if (rawKind === "cover") kind = "cover";
    else if (rawKind === "cv") kind = "cv";
    else if (rawKind === "") kind = untaggedArtifactKind(pdf);

    rows.push({
      reportId,
      pdf,
      html,
      format,
      date,
      kind,
    });
  }
  return rows;
}

/** Resolve the exact PDF path recorded for a report in pdf-index.tsv.
 *
 *  `kind` picks which artifact, "cv" (the default) or "cover". #3959 gave the
 *  manifest a kind column so a report's CV and its cover letter coexist as
 *  separate rows. Without filtering on it, whichever was rendered first wins,
 *  so a report whose cover preceded its CV resolves to the cover — and
 *  reportNumberFromCell above says why that is the failure to avoid: this path
 *  gets attached to a real application, and the wrong document attached
 *  silently is worse than none found.
 *
 *  A row with no kind is a CV unless the filename is a cover letter. A nameless
 *  file stays a CV, because that is what the manifest held before the column.
 *  A cover- prefix or a -cover suffix is the cover that used to share the
 *  report number, so a CV lookup must not return it.
 */
export function pdfIndexEntryForReport(indexText, reportNumber, kind = "cv") {
  if (!Number.isInteger(reportNumber)) return { found: false, path: null, html: null };
  const wanted = kind === "cover" ? "cover" : "cv";
  const rows = parsePdfManifestRows(indexText);
  for (const row of rows) {
    if (!/^\d+$/.test(row.reportId) || Number(row.reportId) !== reportNumber) continue;
    if (row.kind !== wanted) continue;
    return { found: true, path: row.pdf || null, html: row.html || null };
  }
  return { found: false, path: null, html: null };
}

/** Resolve the exact PDF path recorded for a report in pdf-index.tsv. */
export function pdfPathForReport(indexText, reportNumber, kind = "cv") {
  const entry = pdfIndexEntryForReport(indexText, reportNumber, kind);
  return entry.found ? entry.path : null;
}
