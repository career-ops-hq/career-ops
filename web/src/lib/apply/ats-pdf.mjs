import path from "node:path";

const PDF_EXT = /\.pdf$/i;
const ATS_SUFFIX = /\.ats\.pdf$/i;

/**
 * Path for the ATS PDF beside a styled PDF.
 *
 * The suffix is `.ats.pdf`. A company slug is letters, digits, and hyphens,
 * and the styled name ends in `-YYYY-MM-DD.pdf`, so this suffix cannot be a
 * styled CV. Inserting `-ats-` before the date used the same name as a
 * company whose slug ends in `ats`.
 * @param {string} styledPdf
 * @returns {string}
 */
export function atsPdfPath(styledPdf) {
  if (typeof styledPdf !== "string" || !styledPdf) return styledPdf;
  if (ATS_SUFFIX.test(styledPdf)) return styledPdf;
  if (!PDF_EXT.test(styledPdf)) return styledPdf;
  return styledPdf.replace(PDF_EXT, ".ats.pdf");
}

/**
 * The ATS name this repo used to write. A lone file of this shape is kept:
 * the company slug itself can end in `ats`.
 * @param {string} styledPdf
 * @returns {string}
 */
export function legacyAtsPdfPath(styledPdf) {
  if (typeof styledPdf !== "string" || !styledPdf) return styledPdf;
  if (ATS_SUFFIX.test(styledPdf)) return styledPdf;
  const dated = styledPdf.replace(/-(\d{4}-\d{2}-\d{2})(\.pdf)$/i, "-ats-$1$2");
  if (dated !== styledPdf) return dated;
  if (!PDF_EXT.test(styledPdf)) return styledPdf;
  return styledPdf.replace(PDF_EXT, "-ats.pdf");
}

/**
 * Styled CV names from a directory listing.
 *
 * A `.ats.pdf` file is the ATS variant even when it is the only file.
 * An older `…-ats-YYYY-MM-DD.pdf` is dropped only when this list also
 * contains the styled PDF it was built from. A lone file of that older
 * shape stays, because it may be the styled CV for a company whose slug
 * ends in `ats`.
 * @param {string[]} names
 * @returns {string[]}
 */
export function styledCvNames(names) {
  const present = new Set(names);
  const hidden = new Set();
  for (const name of names) {
    if (ATS_SUFFIX.test(path.basename(name))) hidden.add(name);
  }
  for (const name of names) {
    if (hidden.has(name) || ATS_SUFFIX.test(path.basename(name))) continue;
    for (const siblingPath of [atsPdfPath(name), legacyAtsPdfPath(name)]) {
      const sibling = path.basename(siblingPath);
      if (sibling && sibling !== name && present.has(sibling)) hidden.add(sibling);
    }
  }
  return names.filter((name) => !hidden.has(name));
}
