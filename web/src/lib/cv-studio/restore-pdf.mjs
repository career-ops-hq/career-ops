import { parsePdfManifestRows } from "../apply/cv-selection.mjs";

/**
 * Reset clears the on-screen overlay back to the full CV. Apply still reads
 * data/pdf-index.tsv, which Save for apply pointed at the shortened -edited
 * PDF. This puts that row back on the full PDF when the file is there.
 *
 * A cover-letter row is left alone. A row that is not an edited CV is left alone.
 *
 * @param {string} text
 * @param {string} reportNum
 * @param {(relPath: string) => boolean} exists
 * @returns {{ text: string, restored: boolean, reason?: "missing", pdfRel?: string }}
 */
export function restoreFullPdfIndex(text, reportNum, exists) {
  const norm = (value) => String(value || "").trim().replace(/^0+(?=\d)/, "");
  const target = norm(reportNum);
  if (!target) return { text, restored: false };
  let pdfRel = "";
  let changed = false;
  const lines = String(text ?? "").split("\n");
  const next = lines.map((line) => {
    if (!line.trim() || line.startsWith("#")) return line;
    const fields = line.split("\t");
    if (norm(fields[0]) !== target) return line;
    if (parsePdfManifestRows(line)[0]?.kind !== "cv") return line;
    const pdf = fields[1] || "";
    if (!pdf.endsWith("-edited.pdf")) return line;
    const full = `${pdf.slice(0, -"-edited.pdf".length)}.pdf`;
    if (!exists(full)) {
      pdfRel = full;
      return line;
    }
    fields[1] = full;
    if ((fields[2] || "").endsWith("-edited.html")) {
      fields[2] = `${fields[2].slice(0, -"-edited.html".length)}.html`;
    }
    changed = true;
    pdfRel = full;
    return fields.join("\t");
  });
  if (!changed) return pdfRel ? { text, restored: false, reason: "missing", pdfRel } : { text, restored: false };
  const body = next.join("\n");
  return { text: body.endsWith("\n") ? body : `${body}\n`, restored: true, pdfRel };
}
