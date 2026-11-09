// Intercept PDF rendering in cover-letter CLI tests without changing the
// production HTML normalization and ATS replacement diagnostics. Both the
// ATS-normalization and CLI-flags suites share this fixture.
import { register } from 'node:module';

const pdfModule = new URL('../../generate-pdf.mjs', import.meta.url).href;
const stub = 'data:text/javascript,' + encodeURIComponent(`
import { writeFileSync } from 'node:fs';
export { normalizeTextForATS, reportAtsReplacements } from ${JSON.stringify(pdfModule)};
export async function renderHtmlToPdf(html, outputPath, opts = {}) {
  if (process.env.COVER_HTML_CAPTURE) {
    writeFileSync(process.env.COVER_HTML_CAPTURE, html);
  }
  if (process.env.COVER_PDF_CAPTURE) {
    writeFileSync(process.env.COVER_PDF_CAPTURE, JSON.stringify({ outputPath, opts }));
  }
  return { outputPath, pageCount: 1, size: 0 };
}
`);
const hooks = 'data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  if (specifier === './generate-pdf.mjs' && parent.includes('generate-cover-letter.mjs')) {
    return { url: ${JSON.stringify(stub)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`);
register(hooks, import.meta.url);
