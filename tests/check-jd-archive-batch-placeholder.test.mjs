// batch/batch-prompt.md's report template puts "{the JD text from {{JD_FILE}}
// pasted here verbatim}" under the JD heading. A batch report that kept it had no
// JD at all, but the line clears the 40-character floor and is not one of the
// parenthesized placeholders read from modes/, so it counted as an archive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasEmbeddedJdArchive } from '../check-jd-archive.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const report = (section) => `# Evaluation: Acme -- Engineer\n\n## Job Description (archived verbatim)\n\n${section}\n\n---\n\n## Machine Summary\n`;

test('the template really carries the placeholder this rejects', () => {
  const prompt = readFileSync(join(ROOT, 'batch', 'batch-prompt.md'), 'utf8');
  assert.ok(prompt.includes('{the JD text from {{JD_FILE}} pasted here verbatim}'));
});

test('an unfilled batch placeholder is not an archive, however the path was filled in', () => {
  for (const line of [
    '{the JD text from {{JD_FILE}} pasted here verbatim}',
    '{the JD text from <JD file from the job message> pasted here verbatim}',
    '{the JD text from /tmp/batch-jd-0042.txt pasted here verbatim}',
    'Posted: 2026-10-01\n\n{the JD text from {{JD_FILE}} pasted here verbatim}',
  ]) {
    assert.equal(hasEmbeddedJdArchive(report(line)), false, line);
  }
});

test('real JD text that mentions the same words still counts', () => {
  const text = 'Acme is hiring a backend engineer. Please send {the JD text from your last role} pasted here verbatim, along with a short note about your interest in payments infrastructure.';
  assert.equal(hasEmbeddedJdArchive(report(text)), true);
});
