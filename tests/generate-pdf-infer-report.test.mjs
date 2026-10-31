// tests/generate-pdf-infer-report.test.mjs — without --report, generate-pdf
// takes the 3-digit report number from the output file name, then the input
// file name, and never from an ATS variant (modes/pdf.md renders that one
// without --report so it does not replace the styled CV in pdf-index.tsv).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ngenerate-pdf.mjs — report number inferred from the file name');

const { inferReportNumber } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
const num = (out, inp) => inferReportNumber(out, inp)?.reportNum ?? null;

const cases = [
  ['output name', 'output/cv-ana-042-acme-2026-10-30.pdf', 'output/cv.html', '042'],
  ['underscore bounds', 'output/cv_ana_007_acme.pdf', undefined, '007'],
  ['falls back to the input name', 'output/report.pdf', 'output/source_123_.html', '123'],
  ['output wins over input', 'output/cv-ana-042-acme.pdf', 'output/cv-ana-099-acme.html', '042'],
  ['a date is not a report number', 'output/cv-ana-acme-2026-10-30.pdf', 'output/cv-ana-acme.html', null],
  ['four digits are not a report number', 'output/cv-ana-1234-acme.pdf', undefined, null],
  ['directories are ignored', 'output/run-123-x/cv.pdf', 'output/run-123-x/cv.html', null],
  ['ATS variant is never inferred', 'output/cv-ana-042-acme-ats-2026-10-30.pdf', 'output/cv-ana-042-acme-ats.html', null],
  ['nothing to read', undefined, undefined, null],
];
for (const [label, out, inp, want] of cases) {
  const got = num(out, inp);
  if (got === want) pass(`${label}: ${want ?? 'none'}`);
  else fail(`${label}: got ${got}, want ${want}`);
}

const hit = inferReportNumber('output/report.pdf', 'output/source_123_.html');
if (hit?.from === 'output/source_123_.html') pass('reports which path the number came from');
else fail(`from wrong: ${JSON.stringify(hit)}`);
