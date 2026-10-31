// Stands in for generate-pdf.mjs in a generate-cover-letter run: the real text
// pass, and a render that writes out what it was handed instead of opening a
// browser, which the CI test job does not install.
import { writeFileSync } from 'node:fs';

export { normalizeTextForATS } from '../../generate-pdf.mjs';

export async function renderHtmlToPdf(html) {
  writeFileSync(process.env.COVER_HTML_CAPTURE, html);
  return { outputPath: '', pageCount: 1, size: 0 };
}
