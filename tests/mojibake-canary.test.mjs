// tests/mojibake-canary.test.mjs — double-encoded UTF-8 (mojibake) detection.
//
// PR #3157 shipped a template with mojibake through a fully green CI: every check
// passed, and it was only caught in human review before merge. The byte sequences
// â€ Ã© â– ï¬ are the fingerprint of UTF-8 interpreted as Latin-1 and re-encoded.
// This invariant test scans templates/ and modes/ (all locales) for these
// fingerprints and fails naming the file and line.
//
// Run:  node test-all.mjs --only mojibake-canary

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nmojibake-canary — double-encoded UTF-8 detection in templates/ and modes/');

// Forbidden fingerprints: byte-level markers of UTF-8 interpreted as Latin-1
// and re-encoded, NOT legitimate Unicode. These are the exact artifacts that
// appear when text is double-encoded, not random Unicode characters.
const FORBIDDEN_FINGERPRINTS = ['â€', 'Ã©', 'â–', 'ï¬'];

/**
 * Check if a line contains any mojibake fingerprint.
 * @param {string} line - Line to check.
 * @returns {boolean} True if mojibake is detected.
 */
function containsMojibake(line) {
  return FORBIDDEN_FINGERPRINTS.some(fp => line.includes(fp));
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

const treesToScan = [join(ROOT, 'templates'), join(ROOT, 'modes')];
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
    const entryRelativePath = join(relativePath, entry.name);
    
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
  walkAndCheck(tree);
}

if (filesWithMojibake === 0) {
  pass(`No mojibake found in ${filesScanned} files across templates/ and modes/`);
}
