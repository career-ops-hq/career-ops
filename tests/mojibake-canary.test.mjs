// tests/mojibake-canary.test.mjs — double-encoded UTF-8 (mojibake) detection.
//
// PR #3157 shipped a template with mojibake through a fully green CI: every check
// passed, and it was only caught in human review before merge. The byte sequences
// â€ Ã© â– ï¬ are the fingerprint of UTF-8 interpreted as Latin-1 and re-encoded.
// This invariant test scans templates/ and modes/ (all locales) for these
// fingerprints and fails naming the file and line.
// This file contains mojibake-like literals in detector comments and fixtures, so it must stay excluded from its own scan.
//
// Run:  node test-all.mjs --only mojibake-canary

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nmojibake-canary — double-encoded UTF-8 detection in templates/ and modes/');

// Lead byte range: Latin-1/cp1252 characters that correspond to a
// UTF-8 lead byte for a 2-byte (C2-DF), 3-byte (E0-EF), or 4-byte
// (F0-F4) sequence that got misread as single Latin-1/cp1252 bytes.
const LEAD = '\u00c2-\u00f4';

// Continuation range: what a UTF-8 continuation byte (0x80-0xBF)
// decodes to when misread. 0xA0-0xBF map 1:1 to U+00A0-U+00BF under
// both Latin-1 and Windows-1252. 0x80-0x9F only have defined
// *characters* under Windows-1252 (the far more common real-world
// mis-decode) — those are the curly quotes, em dash, euro sign, etc.
// responsible for smart-quote mojibake like "itâ€™s".
const CONT_WIN1252 = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178';
const CONT_LATIN1 = '\u00a0-\u00bf';

const MOJIBAKE_RE = new RegExp(`[${LEAD}][${CONT_WIN1252}${CONT_LATIN1}]`);

/**
 * Check if a line contains any mojibake fingerprint.
 * @param {string} line - Line to check.
 * @returns {boolean} True if mojibake is detected.
 */
function containsMojibake(line) {
  return MOJIBAKE_RE.test(line);
}

// ---------------------------------------------------------------------------
// Unit tests: verify the detection logic distinguishes mojibake from legitimate
// Unicode. This is the regression proof for the "legitimate non-ASCII does not
// trip it" acceptance criterion.
console.log('  Unit tests: detection logic');

// Should flag mojibake
const mojibakeLine = 'This text contains Ã© as a double-encoded artifact';
containsMojibake(mojibakeLine)
  ? pass('containsMojibake correctly flags a string with Ã©')
  : fail('containsMojibake failed to flag Ã© (double-encoded é)');

const spanishMojibakeLine = 'InformaciÃ³n general del aÃ±o segÃºn el documento';
containsMojibake(spanishMojibakeLine)
  ? pass('containsMojibake correctly flags Spanish mojibake')
  : fail('containsMojibake failed to flag Spanish mojibake (InformaciÃ³n / aÃ±o / segÃºn)');

const japaneseMojibakeLine = 'Double-encoded Japanese: ãƒ†ã‚¹ãƒˆ';
containsMojibake(japaneseMojibakeLine)
  ? pass('containsMojibake correctly flags double-encoded Japanese mojibake')
  : fail('containsMojibake failed to flag double-encoded Japanese mojibake');

// Should NOT flag legitimate Unicode
const legitimateUnicode = [
  'café',           // French with accent
  '日本語',         // Japanese
  'مرحبا',         // Arabic
  'naïve façade',   // French with diacritics
  'Мир',           // Russian
  '你好',          // Chinese
];

let allLegitimatePassed = true;
for (const text of legitimateUnicode) {
  if (containsMojibake(text)) {
    fail(`containsMojibake incorrectly flagged legitimate Unicode: "${text}"`);
    allLegitimatePassed = false;
  }
}
if (allLegitimatePassed) {
  pass('containsMojibake does NOT flag legitimate Unicode (café, 日本語, مرحبا, naïve façade, Мир, 你好)');
}

// ---------------------------------------------------------------------------
// Repo-wide scan: walk templates/ and modes/ and check every file.
console.log('  Repo-wide scan: templates/ and modes/');

const treesToScan = [
  { path: join(ROOT, 'templates'), relativePath: 'templates' },
  { path: join(ROOT, 'modes'), relativePath: 'modes' },
];
let filesScanned = 0;
let filesWithMojibake = 0;

/**
 * Recursively walk a directory and check every file for mojibake.
 * @param {string} dir - Directory to walk.
 * @param {string} relativePath - Relative path for error reporting.
 */
function walkAndCheck(dir, relativePath = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      walkAndCheck(fullPath, entryRelativePath);
    } else if (entry.isFile()) {
      filesScanned++;
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (containsMojibake(lines[i])) {
          filesWithMojibake++;
          fail(`Mojibake found in ${entryRelativePath} at line ${i + 1}: "${lines[i].trim()}"`);
          // Don't report every line in the same file — one failure per file is enough
          // to signal the problem without spamming the log.
          break;
        }
      }
    }
  }
}

for (const tree of treesToScan) {
  walkAndCheck(tree.path, tree.relativePath);
}

if (filesWithMojibake === 0) {
  pass(`No mojibake found in ${filesScanned} files across templates/ and modes/`);
}
