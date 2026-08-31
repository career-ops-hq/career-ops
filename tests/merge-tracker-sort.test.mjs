// tests/merge-tracker-sort.test.mjs — #3515: the tracker table is written in
// ascending `#` order.
//
// Rows used to be spliced in directly after the separator row and never
// reordered, so the table was ordered by *when a batch merged* rather than by
// `#`: ascending runs, descending runs and stragglers, all frozen in place.
// Sorting happens at write time, which also repairs an already-scrambled
// tracker on the next merge with no separate migration step.
//
// CLI integration, like tests/merge-tracker.test.mjs: importing
// merge-tracker.mjs would run the merge at import time, so these drive the real
// script through the CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS overrides.
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nmerge-tracker.mjs — table sorted by # ascending (#3515)');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const row = (num, company) =>
  `| ${num} | 2026-01-01 | ${company} | Eng | 4.0/5 | Evaluated | ❌ | `
  + `[${num}](../reports/${num}-${String(company).toLowerCase()}-2026-01-01.md) | seeded |`;

/**
 * One merge run in an isolated workspace.
 * @param {{rows?: string[], additions?: Record<string,string>, args?: string[]}} opts
 * @returns {{tracker: string, output: string}}
 */
function runMerge(opts = {}) {
  const work = mkdtempSync(join(tmpdir(), 'cops-merge-sort-'));
  try {
    const tracker = join(work, 'applications.md');
    const addsDir = join(work, 'adds');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(tracker, TRACKER_HEADER + (opts.rows ?? []).join('\n') + '\n');
    for (const [name, line] of Object.entries(opts.additions ?? {})) {
      writeFileSync(join(addsDir, name), line);
    }
    let output = '';
    try {
      output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs'), ...(opts.args ?? [])], {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
      });
    } catch (e) {
      output = String(e.stdout ?? '') + String(e.stderr ?? '');
    }
    return { tracker: readFileSync(tracker, 'utf-8'), output };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The `#` cell of every table row, in file order (non-numeric cells kept raw). */
function numColumn(trackerText) {
  return trackerText.split('\n')
    .filter(l => l.startsWith('|') && !/^\|\s*#\s*\|/.test(l) && !/^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(l))
    .map(l => l.split('|')[1].trim());
}

try {
  // A newly merged batch lands in numeric order, not at the top of the table.
  const merged = runMerge({
    rows: [row(3, 'Cyberdyne'), row(9, 'Initech')],
    additions: {
      '5-acme.tsv': '5\t2026-02-01\tAcme\tML Eng\tEvaluated\t4.5/5\t❌\t[5](reports/5-acme-2026-02-01.md)\tnew\n',
      '7-globex.tsv': '7\t2026-02-02\tGlobex\tData Eng\tEvaluated\t4.1/5\t❌\t[7](reports/7-globex-2026-02-02.md)\tnew\n',
    },
  });
  const mergedNums = numColumn(merged.tracker);
  if (mergedNums.join(' ') === '3 5 7 9') {
    pass('merge-tracker interleaves a new batch in ascending # order');
  } else {
    fail(`merge-tracker did not sort a merged batch ascending: got [${mergedNums.join(' ')}], want [3 5 7 9]`);
  }

  // An existing scrambled tracker is repaired in place by the same write.
  const repaired = runMerge({
    rows: [row(4, 'Delta'), row(12, 'Lima'), row(2, 'Bravo'), row(11, 'Kilo'), row(1, 'Alfa')],
    additions: {
      '6-echo.tsv': '6\t2026-02-03\tEcho\tPM\tEvaluated\t4.0/5\t❌\t[6](reports/6-echo-2026-02-03.md)\tnew\n',
    },
  });
  const repairedNums = numColumn(repaired.tracker);
  if (repairedNums.join(' ') === '1 2 4 6 11 12') {
    pass('merge-tracker repairs a pre-existing out-of-order tracker on write');
  } else {
    fail(`merge-tracker left the tracker unsorted: got [${repairedNums.join(' ')}], want [1 2 4 6 11 12]`);
  }

  // 11 must sort after 2 — numeric compare, not lexicographic. Covered by the
  // assertion above; asserted separately so a string-sort regression names
  // itself instead of hiding inside the ordering diff.
  if (repairedNums.indexOf('11') > repairedNums.indexOf('2')) {
    pass('merge-tracker sorts # numerically (11 after 2, not lexicographically)');
  } else {
    fail(`merge-tracker sorted # lexicographically: [${repairedNums.join(' ')}]`);
  }

  // Sentinel-numbered rows (AGENTS.md #1799: backfilled rows carry N/A, — or -)
  // get a defined position at the end, in their existing relative order. They
  // are never dropped and never throw the comparator.
  const sentinelRows = [
    row(8, 'Hotel'),
    '| N/A | 2026-01-05 | Sierra | Eng | N/A | Applied | ❌ | — | backfilled, no evaluation |',
    row(3, 'Cyberdyne'),
    '| — | 2026-01-06 | Tango | Eng | — | Applied | ❌ | — | backfilled, no evaluation |',
  ];
  const sentinel = runMerge({
    rows: sentinelRows,
    additions: {
      '5-acme.tsv': '5\t2026-02-01\tAcme\tML Eng\tEvaluated\t4.5/5\t❌\t[5](reports/5-acme-2026-02-01.md)\tnew\n',
    },
  });
  const sentinelNums = numColumn(sentinel.tracker);
  if (sentinelNums.join(' ') === '3 5 8 N/A —') {
    pass('merge-tracker parks sentinel-# rows at the end, in their original relative order');
  } else {
    fail(`merge-tracker mishandled sentinel # rows: got [${sentinelNums.join(' ')}], want [3 5 8 N/A —]`);
  }
  if (sentinelNums.length === 5) {
    pass('merge-tracker drops no rows while sorting');
  } else {
    fail(`merge-tracker lost rows while sorting: ${sentinelNums.length} of 5 remain`);
  }

  // A `#` cell with a numeric prefix (`12draft`) sorts as 12, NOT with the
  // sentinels. This is deliberate and is asserted so it cannot be "tightened"
  // by accident: parseAppLine and the usedNumbers pass both read that cell with
  // a bare parseInt, so such a row is #12 to dedup, to number allocation and to
  // maxNum. Parking it at the bottom would leave a row every other code path
  // calls #12 sitting where nobody can find it by number — the exact failure
  // this sort exists to fix. Raised in review on #3529.
  const prefixed = runMerge({
    rows: [
      row(20, 'Zulu'),
      '| 12draft | 2026-01-07 | Whiskey | Eng | 4.0/5 | Applied | ❌ | — | malformed # cell |',
      '| N/A | 2026-01-05 | Sierra | Eng | N/A | Applied | ❌ | — | backfilled, no evaluation |',
    ],
    additions: {
      '5-acme.tsv': '5\t2026-02-01\tAcme\tML Eng\tEvaluated\t4.5/5\t❌\t[5](reports/5-acme-2026-02-01.md)\tnew\n',
    },
  });
  const prefixedNums = numColumn(prefixed.tracker);
  if (prefixedNums.join(' ') === '5 12draft 20 N/A') {
    pass('merge-tracker sorts a numeric-prefix # cell as its number, matching parseAppLine');
  } else {
    fail(`merge-tracker mishandled a numeric-prefix # cell: got [${prefixedNums.join(' ')}], want [5 12draft 20 N/A]`);
  }

  // --dry-run writes nothing, sort included.
  const scrambled = [row(4, 'Delta'), row(1, 'Alfa')];
  const dry = runMerge({
    rows: scrambled,
    additions: {
      '6-echo.tsv': '6\t2026-02-03\tEcho\tPM\tEvaluated\t4.0/5\t❌\t[6](reports/6-echo-2026-02-03.md)\tnew\n',
    },
    args: ['--dry-run'],
  });
  if (numColumn(dry.tracker).join(' ') === '4 1') {
    pass('merge-tracker --dry-run leaves the table order untouched');
  } else {
    fail(`merge-tracker --dry-run rewrote the table: [${numColumn(dry.tracker).join(' ')}]`);
  }

  // With nothing pending, the merge still repairs an unsorted table — that is
  // the point of sorting at write time rather than at insert time.
  const noAdditions = runMerge({ rows: [row(4, 'Delta'), row(1, 'Alfa')] });
  if (numColumn(noAdditions.tracker).join(' ') === '1 4') {
    pass('merge-tracker sorts an existing tracker even with no pending additions');
  } else {
    fail(`merge-tracker skipped the sort with no additions: [${numColumn(noAdditions.tracker).join(' ')}]`);
  }
} catch (e) {
  fail(`merge-tracker sort tests crashed: ${e.message}`);
}
