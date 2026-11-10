import path from "node:path";

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
 * A company slug can end in `ats`, so a lone `…-ats-YYYY-MM-DD.pdf` stays.
 * @param {string[]} names
 * @returns {string[]}
 */
export function styledCvNames(names) {
  const siblings = new Set();
  for (const name of names) {
    const sibling = path.basename(atsPdfPath(name));
    if (sibling && sibling !== name) siblings.add(sibling);
  }
  return names.filter((name) => !siblings.has(name));
}
