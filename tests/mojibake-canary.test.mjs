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
import { isNestedCheckout } from '../lib/mjs-files.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nmojibake-canary — double-encoded UTF-8 detection in templates/ and modes/');

// Full WHATWG windows-1252 index table for bytes 0x80-0x9F (0xA0-0xFF
// are identity-mapped to U+00A0-U+00FF, same as Latin-1).
const CP1252_HIGH = [
  0x20ac,0x0081,0x201a,0x0192,0x201e,0x2026,0x2020,0x2021,
  0x02c6,0x2030,0x0160,0x2039,0x0152,0x008d,0x017d,0x008f,
  0x0090,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,
  0x02dc,0x2122,0x0161,0x203a,0x0153,0x009d,0x017e,0x0178,
];

// codepoint -> the raw byte value it represents, so a mis-decoded
// character can be mapped back to what it actually was on disk.
const CODEPOINT_TO_BYTE = new Map();
for (let b = 0; b < 0x80; b++) CODEPOINT_TO_BYTE.set(b, b);
for (let b = 0xa0; b <= 0xff; b++) CODEPOINT_TO_BYTE.set(b, b);
for (let i = 0; i < 32; i++) CODEPOINT_TO_BYTE.set(CP1252_HIGH[i], 0x80 + i);

// The legal range for a UTF-8 sequence's FIRST continuation byte
// depends on the lead byte, not just "any byte 0x80-0xBF" — E0, ED,
// F0, and F4 are narrower than the rest to rule out overlong
// encodings and the surrogate / out-of-Unicode-range gaps. This
// extra precision is what tells "ôž" (Slovak, not mojibake — ô's
// byte 0xF4 only legally continues into 0x80-0x8F, and ž's byte
// 0x9E falls outside that) apart from an actual mis-decode.
function allowedContinuationRange(leadByte) {
  if (leadByte >= 0xc2 && leadByte <= 0xdf) return [0x80, 0xbf];
  if (leadByte === 0xe0) return [0xa0, 0xbf];
  if (leadByte >= 0xe1 && leadByte <= 0xec) return [0x80, 0xbf];
  if (leadByte === 0xed) return [0x80, 0x9f];
  if (leadByte >= 0xee && leadByte <= 0xef) return [0x80, 0xbf];
  if (leadByte === 0xf0) return [0x90, 0xbf];
  if (leadByte >= 0xf1 && leadByte <= 0xf3) return [0x80, 0xbf];
  if (leadByte === 0xf4) return [0x80, 0x8f];
  return null;
}

// How many continuation bytes a given lead byte requires -- checking
// only the first continuation byte is not enough for 3- and 4-byte
// sequences: two unrelated legitimate characters can coincidentally
// satisfy just the first check (e.g. "é" (0xE9, a 3-byte lead) followed
// by an em dash (0x97, a valid first continuation byte) in ordinary
// text like "Café—menu" -- there is no real third byte, so this was
// never a genuine encoded sequence).
function continuationByteCount(leadByte) {
  if (leadByte >= 0xc2 && leadByte <= 0xdf) return 1;
  if (leadByte >= 0xe0 && leadByte <= 0xef) return 2;
  if (leadByte >= 0xf0 && leadByte <= 0xf4) return 3;
  return 0;
}

// Scans for a lead byte followed by its FULL required run of valid
// continuation bytes (not just the first). Only the first continuation
// byte is range-restricted per lead (see allowedContinuationRange);
// the rest just need the generic 0x80-0xBF continuation range. Returns
// the matched span and index, or null.
function findMojibakePair(text) {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const leadCp = chars[i].codePointAt(0);
    if (leadCp < 0xc2 || leadCp > 0xf4) continue;
    const leadByte = CODEPOINT_TO_BYTE.get(leadCp);
    if (leadByte === undefined) continue;
    const needed = continuationByteCount(leadByte);
    if (needed === 0 || i + needed >= chars.length) continue;
    const firstRange = allowedContinuationRange(leadByte);
    let ok = true;
    for (let j = 1; j <= needed; j++) {
      const cp = chars[i + j].codePointAt(0);
      const byte = CODEPOINT_TO_BYTE.get(cp);
      if (byte === undefined) { ok = false; break; }
      const range = j === 1 ? firstRange : [0x80, 0xbf];
      if (byte < range[0] || byte > range[1]) { ok = false; break; }
    }
    if (ok) return { pair: chars.slice(i, i + 1 + needed).join(''), index: i };
  }
  return null;
}

/**
 * Check if a line contains any mojibake fingerprint.
 * @param {string} line - Line to check.
 * @returns {boolean} True if mojibake is detected.
 */
function containsMojibake(line) {
  return findMojibakePair(line) !== null;
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

const smartQuoteMojibakeLine = 'it\u00e2\u20ac\u2122s'; // â€™s — the real right-single-quote mojibake
containsMojibake(smartQuoteMojibakeLine)
  ? pass('containsMojibake correctly flags smart-quote mojibake (â€™s)')
  : fail('containsMojibake failed to flag smart-quote mojibake (â€™s)');

const ligatureMojibakeLine = '\u00ef\u00ac\u0081x'; // ï¬ plus invisible U+0081 control character + x
containsMojibake(ligatureMojibakeLine)
  ? pass('containsMojibake correctly flags ligature mojibake (ï¬)')
  : fail('containsMojibake failed to flag ligature mojibake (ï¬)');

// Should NOT flag legitimate Unicode
const legitimateUnicode = [
  'café',           // French with accent
  '日本語',         // Japanese
  'مرحبا',         // Arabic
  'naïve façade',   // French with diacritics
  'Мир',           // Russian
  '你好',          // Chinese
  'Café—menu',     // CodeRabbit's exact example: café + em dash + "menu" must NOT be flagged
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

// Regression guard for the false-positive class CodeRabbit flagged on PR #3205:
// two adjacent accented Latin-Extended letters whose codepoints each *look* like
// a plausible UTF-8 lead/continuation byte on their own, but do NOT form a legal
// lead/continuation byte pair. Slovak "ô" (byte 0xF4) is the top of the lead
// range and only legally continues into 0x80-0x8F, so "ôž"/"ôš" are real words,
// not mis-decodes — the old flat character class wrongly flagged them. Same shape
// of bug in German, Portuguese, Czech, Turkish, etc.
const latinExtendedCleanWords = [
  'môžeš',          // Slovak — CodeRabbit's exact example (ô + ž)
  'kôš',            // Slovak — CodeRabbit's exact example (ô + š)
  'Größe',          // German
  'não',            // Portuguese
  'žluťoučký kůň',  // Czech
  'güneş',          // Turkish
];

let allLatinExtendedPassed = true;
for (const text of latinExtendedCleanWords) {
  if (containsMojibake(text)) {
    fail(`containsMojibake incorrectly flagged legitimate Latin-Extended text: "${text}"`);
    allLatinExtendedPassed = false;
  }
}
if (allLatinExtendedPassed) {
  pass('containsMojibake does NOT flag adjacent-diacritic Latin-Extended words (môžeš, kôš, Größe, não, žluťoučký kůň, güneş)');
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
      // A checkout placed under templates/ or modes/ is another tree's content,
      // and mojibake in it is not this repository's defect to report (#3762).
      // Unlikely there — but "unlikely" is the assumption that let a worktree
      // under tests/ run its own suites as ours.
      if (isNestedCheckout(fullPath)) continue;
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

if (filesScanned === 0) {
  fail('Repo-wide scan found 0 files — check scan root paths (templates/ and modes/ exist?)');
} else if (filesWithMojibake === 0) {
  pass(`No mojibake found in ${filesScanned} files across templates/ and modes/`);
}
