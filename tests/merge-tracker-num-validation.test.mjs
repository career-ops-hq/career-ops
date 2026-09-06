// tests/merge-tracker-num-validation.test.mjs — an addition's tracker number
// must be a whole positive integer, on every parser path (#3706 review).
//
// `parseInt` stops at the first character that cannot continue a number, so
// `17oops` and `17.5` both became 17 and the row merged under a tracker number
// the file never claimed. The downstream `isNaN || === 0` guard could not catch
// it: by then the value is a perfectly valid-looking number. Three paths parse
// a num — headed, headerless tab, headerless pipe — and all three had it.
//
// The other half of this suite is the regression the obvious fix causes.
// `reserve-report-num.mjs` returns a zero-padded 3-digit string (`padStart(3,
// '0')`), and both the batch prompt and web/src/lib/run-prompts.mjs hand that
// straight to the `num` cell — so `035` is the canonical shape of every report
// under 100. A `/^[1-9]\d*$/` validator rejects it and silently drops those
// evaluations, which is strictly worse than the bug being fixed.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';

console.log('\nmerge-tracker.mjs — tracker number validation (#3706 review)');

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const D = '2026-09-04';
const HEADER = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';
const cells = (n) => [n, D, 'Acme', 'Engineer', 'Evaluated', '4.0/5', '❌', `[${n}](reports/${n}-acme-${D}.md)`, 'note'];

/** Render one addition file in the shape each parser path expects. */
const shapes = {
  headed: (n) => `${HEADER}\n${cells(n).join('\t')}\n`,
  'headerless tab': (n) => `${cells(n).join('\t')}\n`,
  // The pipe path is score-before-status, matching applications.md.
  'headerless pipe': (n) => {
    const c = cells(n);
    [c[4], c[5]] = [c[5], c[4]];
    return `| ${c.join(' | ')} |\n`;
  },
};

/** Merge one addition and report the tracker row that landed, if any. */
function mergeOne(shape, num) {
  const work = mkdtempSync(join(tmpdir(), 'cops-num-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds, { recursive: true });
    writeFileSync(tracker, TRACKER);
    writeFileSync(join(adds, 'a.tsv'), shapes[shape](num));
    let out = '';
    try {
      out = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds },
      });
    } catch (e) { out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    const row = readFileSync(tracker, 'utf-8').split('\n').find((l) => /^\|\s*\d/.test(l));
    return { row: row ?? null, out };
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// A cell that is not a whole positive integer must be refused, not truncated.
const REJECT = ['17oops', '17.5', '1e3', '-3', '0', '000', 'N/A', '', ' ', '4 2', '0x11', '+7', '17,5'];

for (const shape of Object.keys(shapes)) {
  for (const bad of REJECT) {
    const { row } = mergeOne(shape, bad);
    if (row === null) pass(`${shape}: refuses num "${bad}"`);
    else fail(`${shape}: num "${bad}" merged as row "${row.trim()}" — a number the file never claimed`);
  }
}

// The canonical zero-padded form must keep working on every path.
for (const shape of Object.keys(shapes)) {
  for (const [text, want] of [['035', '35'], ['007', '7'], ['42', '42'], ['100', '100']]) {
    const { row, out } = mergeOne(shape, text);
    if (row && new RegExp(`^\\|\\s*${want}\\s*\\|`).test(row)) {
      pass(`${shape}: accepts num "${text}" as ${want}`);
    } else {
      fail(`${shape}: num "${text}" did not merge as ${want} — reserve-report-num.mjs pads to 3 digits, so this is the canonical shape below 100. row: ${row ?? '(none)'} | ${out.trim().split('\n').pop()}`);
    }
  }
}
