import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const prompt = readFileSync(fileURLToPath(new URL('../batch/batch-prompt.md', import.meta.url)), 'utf8');

test('every batch CV path carries the report number, so same-day postings at one company cannot collide', () => {
  const paths = prompt.match(/cv-candidate-(?:\{\{REPORT_NUM\}\}-)?\{company-slug\}[^\s`]*/g) || [];
  assert.ok(paths.length >= 3, `expected the HTML, PDF and report-header paths, found ${paths.length}`);
  for (const path of paths) {
    assert.match(path, /^cv-candidate-\{\{REPORT_NUM\}\}-\{company-slug\}/, `path without the report number: ${path}`);
  }
});
