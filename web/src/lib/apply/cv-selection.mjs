/** Return the report number referenced by a tracker report cell. */
export function reportNumberFromCell(cell) {
  const match = String(cell ?? "").match(/(?:^|[^0-9])(\d{1,})(?=[^0-9]|$)/);
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
