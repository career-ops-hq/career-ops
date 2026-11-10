// Like cover-pdf-capture-register.mjs, but the stubbed renderHtmlToPdf also writes the
// options it was called with to $COVER_PDF_CAPTURE, so a test can assert what
// generate-cover-letter.mjs passed to the renderer without launching Chromium.
// With $COVER_PDF_DRAFT set, the stub behaves like an over-budget render: it writes
// a sibling .overflow.pdf draft, returns draftPath, and leaves the output path alone
// (generate-pdf.mjs #6458). Under --strict-pages it throws instead, as the real one does.
import { register } from 'node:module';

const real = new URL('../../generate-pdf.mjs', import.meta.url).href;
const stub = 'data:text/javascript,' + encodeURIComponent(`
import { writeFileSync } from 'node:fs';
export { normalizeTextForATS, reportAtsReplacements } from ${JSON.stringify(real)};
export async function renderHtmlToPdf(html, outputPath, opts = {}) {
  if (process.env.COVER_PDF_CAPTURE) {
    writeFileSync(process.env.COVER_PDF_CAPTURE, JSON.stringify({ outputPath, opts }));
  }
  if (process.env.COVER_PDF_DRAFT) {
    const draftPath = outputPath.replace(/\\.pdf$/i, '') + '.overflow.pdf';
    writeFileSync(draftPath, '%PDF-stub');
    const message = 'Cover letter is 2 pages; the allowed maximum is ' + opts.maxPages + ' page.';
    if (opts.strictPages) {
      throw new Error(message + ' (--strict-pages requested) Rejected draft: ' + draftPath + ' (nothing was written to the output path).');
    }
    console.warn('⚠️  ' + message + ' Overflow draft: ' + draftPath + ' (nothing was written to the output path).');
    return { outputPath, draftPath, pageCount: 2, size: 0 };
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
