// tests/tracker-links-parens.test.mjs — Bug 4 regression: normalizeReportLink
// must not truncate report paths that contain parentheses in the filename.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntracker-links — parentheses in report filenames');

const { normalizeReportLink } = await import(
  pathToFileURL(join(ROOT, 'tracker-links.mjs')).href
);

const trackerDir = join(ROOT, 'data');
const repoRoot = ROOT;

// Plain filename — must still work after the regex change.
{
  const input = '[42](reports/042-acme-2026-08-31.md)';
  const result = normalizeReportLink(input, trackerDir, repoRoot);
  if (result.includes('042-acme-2026-08-31.md')) pass('plain filename preserved');
  else fail(`plain filename mangled: ${result}`);
}

// Filename with one level of parentheses — was truncated by the old [^)] class.
{
  const input = '[42](reports/042-acme-(senior)-2026-08-31.md)';
  const result = normalizeReportLink(input, trackerDir, repoRoot);
  if (result.includes('042-acme-(senior)-2026-08-31.md')) pass('filename with parens preserved');
  else fail(`filename with parens truncated: "${result}"`);
}

// Non-report link — must be left untouched.
{
  const input = '[company](https://example.com)';
  const result = normalizeReportLink(input, trackerDir, repoRoot);
  if (result === input) pass('non-report link left untouched');
  else fail(`non-report link modified: ${result}`);
}

// Multiple links in one cell — both should normalize correctly.
{
  const input = '[42](reports/042-foo-(bar)-2026-08-01.md) [43](reports/043-baz-2026-08-02.md)';
  const result = normalizeReportLink(input, trackerDir, repoRoot);
  if (result.includes('042-foo-(bar)-2026-08-01.md') && result.includes('043-baz-2026-08-02.md')) {
    pass('multiple links with and without parens both normalize correctly');
  } else {
    fail(`multi-link normalization failed: "${result}"`);
  }
}
