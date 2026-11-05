/**
 * The report keyword panel scores the tailored CV when one was kept beside
 * the indexed PDF. The PDF bytes are not a CV the matcher can read. Master
 * cv.md is the fallback, and that fallback is "pass no --cv".
 */
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
