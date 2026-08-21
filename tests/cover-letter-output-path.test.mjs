// tests/cover-letter-output-path.test.mjs — generate-cover-letter --out
// must preserve directories that stay inside output/ (#2940).
//
// safeOutputPath() used basename() and always wrote output/<file>, so a
// legitimate bundle path such as output/{NNN}-{company}-{role}/cover-letter/vNNN/
// was flattened to output/<file> and the process still exited 0. generate-pdf.mjs
// already keeps those nested paths; cover letters must match.
//
// Two directions, matching the maintainer note on #2940:
//   1. A path that stays inside output/ is honoured, subdirectory included.
//   2. A path that would escape output/ is rejected — not silently rewritten.
import { resolve, join, relative, isAbsolute } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { safeOutputPath } from '../generate-cover-letter.mjs';

console.log('\nCover letter --out preserves output/ subdirectories (#2940)');

const OUTPUT_ROOT = resolve(ROOT, 'output');

function underOutput(absPath) {
  const rel = relative(OUTPUT_ROOT, absPath);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function checkEqual(label, actual, expected) {
  if (resolve(actual) === resolve(expected)) pass(label);
  else fail(`${label} — expected ${expected}, got ${actual}`);
}

function checkThrows(label, raw) {
  try {
    const got = safeOutputPath(raw);
    fail(`${label} — expected a refusal, got ${got}`);
  } catch (err) {
    const msg = String(err && err.message);
    if (/refus/i.test(msg) && /output/i.test(msg)) pass(label);
    else fail(`${label} — unexpected error: ${msg}`);
  }
}

// --- Honour paths that stay inside output/ ---------------------------------
// The issue repro: --out output/_repro/v001/cover.pdf must not flatten.
checkEqual(
  'nested path under output/ keeps its subdirectory',
  safeOutputPath(join('output', '_repro', 'v001', 'cover.pdf')),
  join(OUTPUT_ROOT, '_repro', 'v001', 'cover.pdf'),
);

// Maintainer reproduction: application-scoped bundle layout from modes/pdf.md.
checkEqual(
  'application-bundle cover-letter path is preserved',
  safeOutputPath(join('output', '012-acme-vp-marketing', 'cover-letter', 'v2', 'carta.pdf')),
  join(OUTPUT_ROOT, '012-acme-vp-marketing', 'cover-letter', 'v2', 'carta.pdf'),
);

// Bare filename remains the documented default: output/<file>.
checkEqual(
  'bare filename still lands in output/',
  safeOutputPath('cover.pdf'),
  join(OUTPUT_ROOT, 'cover.pdf'),
);

// Absolute path already inside output/ is accepted as-is.
checkEqual(
  'absolute path inside output/ is accepted',
  safeOutputPath(join(OUTPUT_ROOT, 'nested', 'letter.pdf')),
  join(OUTPUT_ROOT, 'nested', 'letter.pdf'),
);

{
  const got = safeOutputPath(join('output', '_repro', 'v001', 'cover.pdf'));
  if (underOutput(got)) pass('honoured nested path stays inside output/');
  else fail(`honoured nested path escaped output/: ${got}`);
}

// --- Reject escapes loudly; do not flatten to output/<basename> ------------
// Pass the raw CLI strings. path.join() collapses `..` before the guard sees
// them, which is exactly the silent-rewrite behaviour this test must catch.
checkThrows('parent-directory escape is refused', 'output/../secrets.pdf');
checkThrows('nested traversal escape is refused', 'output/foo/../../etc/passwd');
checkThrows('absolute path outside output/ is refused', resolve(ROOT, 'cover.pdf'));
checkThrows('absolute path in /tmp is refused', join('/tmp', 'cover.pdf'));
checkThrows('output/ itself (no filename) is refused', 'output');
