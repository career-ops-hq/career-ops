/**
 * The ATS PDF sits beside the styled PDF. It is not indexed, so Apply finds
 * it by name. `cv-jane-018-acme-2026-11-05.pdf` pairs with
 * `cv-jane-018-acme-ats-2026-11-05.pdf`.
 */
import fs from "node:fs";

const DATED_ATS = /-ats-(\d{4}-\d{2}-\d{2})\.pdf$/i;
const UNDATED_ATS = /-ats\.pdf$/i;

/**
 * @param {string} styledPdf
 * @returns {string}
 */
export function atsPdfPath(styledPdf) {
  if (typeof styledPdf !== "string" || !styledPdf) return styledPdf;
  if (DATED_ATS.test(styledPdf) || UNDATED_ATS.test(styledPdf)) return styledPdf;
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
