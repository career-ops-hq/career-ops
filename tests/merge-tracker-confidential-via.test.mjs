// tests/merge-tracker-confidential-via.test.mjs — two undisclosed employers are
// not one employer (#3410).
//
// `?` is the marker for "end employer not disclosed", so every such row
// normalizes to the SAME empty company key. The Via column is what tells two of
// them apart, and merge-tracker's tier-2 guard exists for exactly that: the
// same role through two different agencies is two real submissions, and merging
// them silently is the double-submission hazard Via was added (#1596) to
// surface.
//
// The guard rejected only when the two vias DIFFERED, so two EMPTY ones
// compared equal and fell through to the fuzzy title match. Measured on main,
// an existing `? / Program Manager` (4.2, Applied, report [1]) against an
// unrelated `? / Senior Program Manager` addition:
//
//   | 1 | 2026-02-10 | ? | Program Manager | 3.6/5 | Applied | ❌ |
//     [2](../reports/002-…) | … Superseded report [1] (was 4.2/5) …
//
// One row where there were two. The surviving row keeps the first
// application's Applied status while its date, score, PDF flag and REPORT LINK
// all now describe the other posting — and calls report [1] "Superseded", which
// it is not. The tracker is gitignored and no .bak is written, so there is
// nothing to recover from.
//
// Run:  node --test tests/merge-tracker-confidential-via.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The Via column sits after Company, which is where `--migrate-via` puts it.
const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|-----|------|-------|--------|-----|--------|-------|',
];

/**
 * Merge one addition into a one-row `?` tracker and report what happened.
 *
 * @param {{existingVia: string, existingRole?: string, additionRole: string,
 *          additionVia?: string|null, additionReport?: number}} opts
 */
function merge(opts) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-merge-conf-'));
  try {
    const tracker = join(dir, 'applications.md');
    const addsDir = join(dir, 'adds');
    mkdirSync(addsDir, { recursive: true });

    writeFileSync(tracker, [
      ...HEADER,
      `| 1 | 2026-01-05 | ? | ${opts.existingVia} | ${opts.existingRole ?? 'Program Manager'} | 4.2/5 | Applied | ✅ | [1](../reports/001-a-2026-01-05.md) | first application |`,
      '',
    ].join('\n'));

    const report = opts.additionReport ?? 2;
    const fields = ['2', '2026-02-10', '?', opts.additionRole, 'Evaluated', '3.6/5', '❌',
      `[${report}](reports/00${report}-b-2026-02-10.md)`, 'second application'];
    if (opts.additionVia) fields.push(`via=${opts.additionVia}`);
    writeFileSync(join(addsDir, '002-b.tsv'), `${fields.join('\t')}\n`);

    execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
    });

    const text = readFileSync(tracker, 'utf-8');
    const rows = text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
    return { rows, text };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

test('two `?` rows with no Via stay distinct instead of merging', () => {
  // The bug. Both sides carry the direct-application marker, which normalizes
  // to empty — so before the fix the guard saw '' === '' and let the fuzzy title
  // match collapse them.
  const { rows, text } = merge({ existingVia: '—', additionRole: 'Senior Program Manager' });
  assert.equal(rows.length, 2, `two unrelated confidential rows merged into one:\n${text}`);

  // And the first row is intact — not merely present. A merge that kept two rows
  // while overwriting one of them would satisfy a count assertion and none of
  // the point.
  const first = rows.find((r) => /^\|\s*1\s*\|/.test(r));
  assert.match(first, /4\.2\/5/, 'the original score was overwritten');
  assert.match(first, /001-a-2026-01-05/, 'the original report link was overwritten');
  assert.match(first, /2026-01-05/, 'the original date was overwritten');
  assert.doesNotMatch(first, /Superseded/, 'the untouched report was marked superseded');
});

test('an empty Via is unknown, not a matching value', () => {
  // The same defect reached through the other spelling: a row predating Via
  // tracking has an empty cell rather than the em-dash marker.
  const { rows } = merge({ existingVia: '', additionRole: 'Program Manager' });
  assert.equal(rows.length, 2);
});

test('the same agency on both sides still merges', () => {
  // The behaviour the guard was written to allow — one agency re-blasting one
  // listing IS a duplicate. Without this the fix would read as "never merge a
  // `?` row", which is a different and worse rule.
  const { rows } = merge({ existingVia: 'Hays', additionRole: 'Program Manager', additionVia: 'Hays' });
  assert.equal(rows.length, 1, 'a same-channel duplicate should still collapse');
});

test('two different agencies still stay distinct', () => {
  const { rows } = merge({ existingVia: 'Hays', additionRole: 'Program Manager', additionVia: 'Insight Global' });
  assert.equal(rows.length, 2);
});

test('a LEGACY tracker with no Via column keeps its existing behaviour', () => {
  // The boundary, and the reason the rule is gated on the column existing.
  // Without a Via column every row parses with via='' and the addition's own
  // tag is cleared on purpose, so empty-vs-empty is the NORMAL state for a
  // genuine same-agency re-blast rather than a missing signal. Requiring a
  // value there would turn every legacy re-blast into a duplicate row —
  // tracker-columns-tests.mjs §12b asserts exactly that case, and caught this
  // when the first version of the fix was not gated.
  //
  // So #3410 is closed for a migrated tracker and unchanged for a legacy one,
  // where `--migrate-via` is the way to get the guard. Pinned so that is a
  // decision on record rather than an omission.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-merge-legacy-'));
  try {
    const tracker = join(dir, 'applications.md');
    const addsDir = join(dir, 'adds');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-05 | ? | Data Engineer | 4.1/5 | Applied | ✅ | — | blind listing |',
      '',
    ].join('\n'));
    writeFileSync(join(addsDir, '002-b.tsv'),
      ['2', '2026-02-10', '?', 'Data Engineer', 'Applied', '4.3/5', '✅', '—', 're-blast', 'via=Hays'].join('\t') + '\n');
    execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
    });
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
    assert.equal(rows.length, 1, 'a legacy same-agency re-blast must still update in place');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a genuine re-evaluation still merges on its report number', () => {
  // What keeps the fix from costing anything real. Tier 1 matches on the report
  // number, which is provable identity rather than a fuzzy guess, and runs
  // BEFORE this guard — so re-running an evaluation of the same confidential
  // posting still updates its row, Via or no Via.
  const { rows } = merge({ existingVia: '—', additionRole: 'Program Manager', additionReport: 1 });
  assert.equal(rows.length, 1, 'a re-eval carrying the same report number must still update in place');
});
