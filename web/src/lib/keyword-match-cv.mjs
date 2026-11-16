import fs from "node:fs";

/**
 * @param {string|null|undefined} indexedPdf
 * @returns {string|null}
 */
export function tailoredCvForKeywordMatch(indexedPdf) {
  if (typeof indexedPdf !== "string" || !indexedPdf) return null;
  const html = indexedPdf.replace(/\.pdf$/i, ".html");
  if (html === indexedPdf) return null;
  try {
    if (fs.existsSync(html) && fs.statSync(html).isFile()) return html;
  } catch {
    return null;
  }
  return null;
}
