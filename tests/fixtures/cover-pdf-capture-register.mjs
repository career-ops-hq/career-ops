// Like cover-pdf-register.mjs, but the stubbed renderHtmlToPdf also writes the
// options it was called with to $COVER_PDF_CAPTURE, so a test can assert what
// generate-cover-letter.mjs passed to the renderer without launching Chromium.
import { register } from 'node:module';

const stub = 'data:text/javascript,' + encodeURIComponent(`
import { writeFileSync } from 'node:fs';
export async function renderHtmlToPdf(html, outputPath, opts = {}) {
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
