// tests/scan-summary-marker.test.mjs — the marker is an interface, the banner
// is decoration (#3560).
//
// The point of the marker is that a consumer can find where a summary starts
// without knowing any scanner's banner text. Two things have to hold for that
// to be true, and both are asserted here:
//
//   1. The marker line is exactly SCAN_SUMMARY_MARKER, alone on its line, so
//      whole-line equality works. A consumer matching a prefix would keep
//      working if someone appended a scanner id; one matching the whole line
//      would not, and the whole-line form is the documented contract.
//   2. The banner underneath is byte-identical to what the scanners printed
//      before the marker existed. That is the promise the issue was answered
//      with ("existing banners left as they are underneath"), and it is a
//      golden string here rather than a claim in a PR description.
//
// Run:  node --test tests/scan-summary-marker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_SUMMARY_MARKER, scanSummaryHeaderLines, printScanSummaryHeader } from '../lib/scan-summary-marker.mjs';

const RULE = '━'.repeat(45);

// The token itself is the interface, so it is pinned as a literal here and not
// only compared against the imported constant: renaming or re-spelling
// SCAN_SUMMARY_MARKER would otherwise leave every assertion green while every
// consumer downstream breaks.
test('the marker token is exactly this string', () => {
  assert.equal(SCAN_SUMMARY_MARKER, '::career-ops:scan-summary::');
  assert.equal(scanSummaryHeaderLines('Portal Scan', '2026-09-03')[1], '::career-ops:scan-summary::');
});

test('the marker is a whole line of its own, immediately above the banner', () => {
  const lines = scanSummaryHeaderLines('Portal Scan', '2026-09-03');
  assert.deepEqual(lines, ['', SCAN_SUMMARY_MARKER, RULE, 'Portal Scan — 2026-09-03', RULE]);
  assert.equal(lines[1].trim(), SCAN_SUMMARY_MARKER);
  // Nothing is appended to the token — that is what makes whole-line equality
  // a usable contract for consumers.
  assert.equal(lines[1], SCAN_SUMMARY_MARKER);
});

test('printed output keeps the pre-marker banner byte-for-byte', () => {
  const out = [];
  printScanSummaryHeader('Reverse ATS Scan', '2026-09-03', (l) => out.push(l));
  const printed = out.map((l) => `${l}\n`).join('');
  // What the scanner printed before this change, with one line inserted:
  //   console.log(`\n${'━'.repeat(45)}`)
  //   console.log(`Reverse ATS Scan — ${date}`)
  //   console.log(`${'━'.repeat(45)}`)
  const before = `\n${RULE}\n` + `Reverse ATS Scan — 2026-09-03\n` + `${RULE}\n`;
  assert.equal(printed, `\n${SCAN_SUMMARY_MARKER}\n${before.slice(1)}`);
  assert.equal(printed.split('\n')[1], SCAN_SUMMARY_MARKER);
});

test('emit defaults to console.log and receives one call per line', () => {
  const calls = [];
  const original = console.log;
  console.log = (...a) => calls.push(a);
  try {
    printScanSummaryHeader('Interamt Scan', '2026-09-03');
  } finally {
    console.log = original;
  }
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map((c) => c[0]), scanSummaryHeaderLines('Interamt Scan', '2026-09-03'));
  // One argument per call: console.log(a, b) would join with a space and put
  // something after the marker on its line.
  assert.ok(calls.every((c) => c.length === 1));
});

test('the title is the only thing that varies between scanners', () => {
  for (const title of ['Portal Scan', 'Reverse ATS Scan', 'Interamt Scan', 'HN Scan']) {
    const lines = scanSummaryHeaderLines(title, '2026-09-03');
    assert.equal(lines[1], SCAN_SUMMARY_MARKER);
    assert.equal(lines[3], `${title} — 2026-09-03`);
  }
});

// The module can be perfect and the marker still absent from a run: what makes
// the boundary usable is that every scanner actually emits it. Assert the
// wiring per scanner, so a refactor that drops one call fails here instead of
// silently returning a consumer to banner-matching.
//
// Deliberately narrow: this looks for the helper call and the banner title it
// is given, not for the rule characters. A test that grepped for
// `'━'.repeat(45)` would also match stats.mjs and weekly-digest.mjs, which
// build the same rule for unrelated tables, and would fail the day either of
// those is touched.
test('every scanner imports the module and prints the header', async () => {
  const { readFileSync } = await import('node:fs');
  const scanners = [
    ['scan.mjs', 'Portal Scan'],
    ['scan-ats-full.mjs', 'Reverse ATS Scan'],
    ['scan-interamt.mjs', 'Interamt Scan'],
    ['scan-hn.mjs', 'HN Scan'],
  ];
  for (const [file, title] of scanners) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8');
    assert.match(src, /from '\.\/lib\/scan-summary-marker\.mjs'/, `${file} imports the module`);
    assert.ok(
      src.includes(`printScanSummaryHeader('${title}'`),
      `${file} prints the summary header with the banner title "${title}"`,
    );
  }
});
