// tests/email-tailored-cv-source.test.mjs — email copy and attachment stay aligned (#3460).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, ROOT } from './helpers.mjs';

const emailMode = readFileSync(join(ROOT, 'modes', 'email.md'), 'utf8');
const normalizedEmailMode = emailMode.replace(/\s+/g, ' ');

const guarantees = [
  ['normalizes padded report numbers', '`008` and `8` are the same report'],
  ['reads the manifest HTML rather than parsing PDFs', 'Use the HTML companion, never the PDF'],
  ['does not cross role boundaries by company name', 'the same company but a different report'],
  ['keeps tailored output below primary factual sources', 'alignment guide, not a new source of truth'],
  ['falls back to the master CV when tailored HTML is unavailable', 'fall back explicitly to `cv.md`'],
  ['uses one manifest row for prose and attachment', 'Do not select the prose source and attachment from different rows'],
];

for (const [description, marker] of guarantees) {
  if (normalizedEmailMode.includes(marker)) {
    pass(`email mode ${description}`);
  } else {
    fail(`email mode no longer ${description}`);
  }
}
