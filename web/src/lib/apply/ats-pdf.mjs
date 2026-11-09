import fs from "node:fs";

/**
 * Sibling path for the ATS PDF. Always inserts `-ats-` before the date.
 * A company slug can itself end in `ats` (`cv-…-ats-2026-07-26.pdf`), so a
 * name that already matches that shape is still the styled CV.
 * @param {string} styledPdf
 * @returns {string}
 */
export function atsPdfPath(styledPdf) {
  if (typeof styledPdf !== "string" || !styledPdf) return styledPdf;
  const dated = styledPdf.replace(/-(\d{4}-\d{2}-\d{2})(\.pdf)$/i, "-ats-$1$2");
  if (dated !== styledPdf) return dated;
  return styledPdf.replace(/\.pdf$/i, "-ats.pdf");
}

/**
 * @param {string|null|undefined} styledPdf
 * @param {(path: string) => boolean} [exists]
 * @returns {string|null}
 */
export function preferAtsPdf(styledPdf, exists = fs.existsSync) {
  if (!styledPdf) return null;
  const ats = atsPdfPath(styledPdf);
  if (ats !== styledPdf && exists(ats)) return ats;
  return styledPdf;
}
