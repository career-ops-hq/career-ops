// tests/merge-tracker.test.mjs — regression coverage for status validation.
//
// `validateStatus` is not exported and importing merge-tracker.mjs runs the CLI
// (top-level lock + merge), so this exercises the real merge path as a CLI
// integration test via the CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS env
// overrides the script already supports for test isolation.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nmerge-tracker.mjs — status validation');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

// One merge run in an isolated workspace. Returns the merged tracker text.
function runMerge(additions) {
  return runMergeDetailed(additions).tracker;
}

/**
 * Merge run in an isolated workspace, exposing everything the data-loss
 * regressions need to assert on: the merged tracker text, the process output
 * and exit code, and which TSVs the run archived into merged/.
 *
 * @param {Record<string,string>} additions - TSV filename → file content.
 * @param {{rows?: string, header?: string}} [opts] - Seed rows appended to the
 *   tracker header, or a replacement header (used to build a tracker whose
 *   table separator row is missing).
 * @returns {{tracker: string, output: string, exitCode: number, archived: string[], pending: string[]}}
 */
function runMergeDetailed(additions, opts = {}) {
  const work = mkdtempSync(join(tmpdir(), 'cops-merge-'));
  try {
    const tracker = join(work, 'applications.md');
    const addsDir = join(work, 'adds');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(tracker, (opts.header ?? TRACKER_HEADER) + (opts.rows ?? ''));
    for (const [name, line] of Object.entries(additions)) {
      writeFileSync(join(addsDir, name), line);
    }
    let output = '';
    let exitCode = 0;
    try {
      output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8',
        timeout: 30000,
        env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
      });
    } catch (e) {
      output = String(e.stdout ?? '') + String(e.stderr ?? '');
      exitCode = e.status ?? -1;
    }
    const mergedDir = join(addsDir, 'merged');
    return {
      tracker: readFileSync(tracker, 'utf-8'),
      output,
      exitCode,
      archived: existsSync(mergedDir) ? readdirSync(mergedDir) : [],
      pending: readdirSync(addsDir).filter(f => f.endsWith('.tsv')),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Data rows of a merged tracker, in file order. */
function dataRows(trackerText) {
  return trackerText.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
}

try {
  // TSV column order is status-BEFORE-score (per the batch TSV contract).
  // "Hired" is canonical (states.yml) — the merge must keep it, not downgrade
  // it to "Evaluated" the way an unrecognized status would be.
  const hired = runMerge({
    '1-acme.tsv': '1\t2026-01-01\tAcme\tML Eng\tHired\t4.5/5\t✅\t[1](reports/1-acme-2026-01-01.md)\tlanded the job\n',
  });
  const hiredRow = hired.split('\n').find(l => /\bAcme\b/.test(l)) || '';
  if (/\|\s*Hired\s*\|/.test(hiredRow) && !/\|\s*Evaluated\s*\|/.test(hiredRow)) {
    pass('merge-tracker preserves the canonical Hired status (no silent downgrade)');
  } else {
    fail(`merge-tracker mishandled Hired: ${hiredRow.trim()}`);
  }

  // "accepted" is a states.yml alias of Hired — it must resolve to Hired.
  const accepted = runMerge({
    '2-globex.tsv': '2\t2026-01-02\tGlobex\tData Eng\taccepted\t4.0/5\t✅\t[2](reports/2-globex-2026-01-02.md)\toffer accepted\n',
  });
  const acceptedRow = accepted.split('\n').find(l => /\bGlobex\b/.test(l)) || '';
  if (/\|\s*Hired\s*\|/.test(acceptedRow)) {
    pass('merge-tracker resolves the "accepted" alias to Hired');
  } else {
    fail(`merge-tracker did not resolve accepted -> Hired: ${acceptedRow.trim()}`);
  }
} catch (e) {
  fail(`merge-tracker.mjs tests crashed: ${e.message}`);
}

// ── #2392 gap 1: a SECOND update to the same row was silently dropped ───────
// The update path located the row with appLines.indexOf(duplicate.raw), where
// `raw` was the snapshot taken when the tracker was parsed. After the first
// write the snapshot no longer matched any line, so the second addition hit
// indexOf() === -1, fell through a branch with no else, and was archived into
// merged/ anyway. The tracker is gitignored and no .bak is written, so the
// higher-scored evaluation was gone for good.
console.log('\nmerge-tracker.mjs — repeated updates to one row (#2392)');
try {
  const seeded =
    '| 1 | 2026-01-01 | Acme | Staff Data Platform Engineer | 4.0/5 | Evaluated | ❌ | ' +
    '[1](reports/001-acme-2026-01-01.md) | original eval |\n';
  const res = runMergeDetailed({
    // Filenames sort a → b, so 4.2 is applied first and 4.7 second: the second,
    // BETTER evaluation is exactly the one the old code dropped.
    'a-001-acme.tsv': '1\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tsecond look\n',
    'b-001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tthird look\n',
  }, { rows: seeded });

  const rows = dataRows(res.tracker);
  if (rows.length === 1 && /4\.7\/5/.test(rows[0])) {
    pass('second update to the same row lands (4.0 → 4.2 → 4.7, one row)');
  } else {
    fail(`second update to the same row was dropped: ${rows.length} row(s): ${rows.join(' // ')}`);
  }

  // The summary must count both updates. Reporting "1 updated" for two applied
  // updates is how the loss stayed invisible.
  if (/🔄2 updated/.test(res.output)) {
    pass('summary counts both in-place updates');
  } else {
    fail(`summary undercounted the updates: ${res.output.split('\n').find(l => l.includes('Summary:')) || '(no summary)'}`);
  }

  // The score comparison must read the CURRENT row, not the parse-time
  // snapshot: a lower-scored addition arriving after a higher-scored one must
  // be skipped rather than overwriting it.
  const downgrade = runMergeDetailed({
    'a-001-acme.tsv': '1\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\thigh\n',
    'b-001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tlow\n',
  }, { rows: seeded });
  const downgradeRows = dataRows(downgrade.tracker);
  // Both the surviving row AND the accounting have to be right: against the
  // stale-snapshot code the 4.2 addition compared against the parse-time 4.0,
  // was announced as an update, and only failed to overwrite because its
  // indexOf() lookup silently missed. Same file on disk, opposite reason.
  if (downgradeRows.length === 1 && /4\.7\/5/.test(downgradeRows[0]) && /⏭️1 skipped/.test(downgrade.output)) {
    pass('a later lower-scored addition is skipped against the CURRENT score, not the parse-time one');
  } else {
    fail(`stale score comparison mishandled the downgrade: ${downgradeRows.join(' // ')} | ${downgrade.output.split('\n').find(l => l.includes('Summary:')) || '(no summary)'}`);
  }
} catch (e) {
  fail(`merge-tracker repeated-update tests crashed: ${e.message}`);
}

// ── #2392 gap 3: no dedup between rows added in the same run ────────────────
// All three dedup tiers search `existingApps`, which only ever held rows read
// from the file. Rows appended during the run went to `newLines` and were
// invisible, so two TSVs for one company+role in a single batch both appended.
console.log('\nmerge-tracker.mjs — intra-run dedup (#2392)');
try {
  const sameRole = runMergeDetailed({
    '010-acme.tsv': '10\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[10](reports/010-acme-2026-02-01.md)\tfirst pass\n',
    '011-acme.tsv': '11\t2026-02-02\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.6/5\t❌\t[11](reports/011-acme-2026-02-02.md)\tsecond pass\n',
  });
  const sameRows = dataRows(sameRole.tracker);
  if (sameRows.length === 1) {
    pass('two TSVs for one company+role in one run produce a single tracker row');
  } else {
    fail(`intra-run duplicate rows appended: ${sameRows.length} rows: ${sameRows.join(' // ')}`);
  }
  // Dedup is only worth having if the better evaluation is the one kept — a
  // dedup that drops the higher score is the same data loss by another route.
  if (sameRows.length === 1 && /4\.6\/5/.test(sameRows[0])) {
    pass('the higher-scored of two same-run evaluations wins the merged row');
  } else {
    fail(`same-run dedup kept the wrong evaluation: ${sameRows.join(' // ')}`);
  }

  // Control: dedup must not become greedy. Distinct roles at the same company
  // arriving in one run are two real applications and must both survive.
  const distinct = runMergeDetailed({
    '020-acme.tsv': '20\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[20](reports/020-acme-2026-02-01.md)\tplatform\n',
    '021-acme.tsv': '21\t2026-02-02\tAcme\tDirector of Product Marketing\tEvaluated\t4.6/5\t❌\t[21](reports/021-acme-2026-02-02.md)\tmarketing\n',
  });
  const distinctRows = dataRows(distinct.tracker);
  if (distinctRows.length === 2) {
    pass('distinct roles at one company in the same run stay separate rows');
  } else {
    fail(`same-run dedup collapsed two distinct roles: ${distinctRows.join(' // ')}`);
  }
} catch (e) {
  fail(`merge-tracker intra-run dedup tests crashed: ${e.message}`);
}

// ── #2392 gap 2: Notes overwritten on a score upgrade ───────────────────────
// The update path rebuilt Notes as `Re-eval {date} ({old}→{new}). {new notes}`,
// throwing the existing cell away. The assertions below are on consequences,
// not text: followup-cadence.mjs must still read the notes-sourced apply date,
// and merge-tracker's own sibling-req guard must still find the req number.
console.log('\nmerge-tracker.mjs — Notes preserved across a score upgrade (#2392)');
try {
  const APPLIED_ROW =
    '| 1 | 2026-01-01 | Acme | Staff Data Platform Engineer | 4.0/5 | Applied | ❌ | ' +
    '[1](reports/001-acme-2026-01-01.md) | Applied 2026-01-15. Req R_1488728. recruiter jane@acme.example |\n';
  const upgraded = runMergeDetailed({
    '001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tre-scored after JD refresh\n',
  }, { rows: APPLIED_ROW });
  const upgradedRow = dataRows(upgraded.tracker)[0] || '';

  if (/4\.7\/5/.test(upgradedRow) && /re-scored after JD refresh/.test(upgradedRow) && /Re-eval 2026-03-01/.test(upgradedRow)) {
    pass('score upgrade still records the new score, new notes and the re-eval marker');
  } else {
    fail(`score upgrade lost the new evaluation's own content: ${upgradedRow}`);
  }

  if (/Applied 2026-01-15/.test(upgradedRow) && /R_1488728/.test(upgradedRow) && /jane@acme\.example/.test(upgradedRow)) {
    pass('score upgrade preserves the existing Notes (apply marker, req number, contact)');
  } else {
    fail(`score upgrade destroyed the existing Notes: ${upgradedRow}`);
  }

  // Consequence 1: the follow-up clock. followup-cadence prefers the
  // "Applied YYYY-MM-DD" marker in Notes over the Date column, so losing it
  // silently re-dates the application to the evaluation date.
  const { analyzeFromContent } = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);
  const cadence = analyzeFromContent(upgraded.tracker, '');
  const entry = (cadence.entries || []).find(e => e.num === 1);
  if (entry && entry.appliedDate === '2026-01-15' && entry.appDateSource === 'notes') {
    pass('followup-cadence still measures from the notes apply date after a merge upgrade');
  } else {
    fail(`follow-up clock reset by the merge: ${JSON.stringify(entry && { appliedDate: entry.appliedDate, appDateSource: entry.appDateSource })}`);
  }

  // Consequence 2: merge-tracker's own #1524 sibling-req guard reads the req
  // number back out of Notes. With the req number erased, a genuinely distinct
  // posting with a similar title folds into the row instead of being added.
  // "Senior Staff Data Platform Engineer" fuzzy-matches the row's title, so
  // only the req-number mismatch can keep the two rows apart.
  const sibling = runMergeDetailed({
    '002-acme.tsv': '2\t2026-04-01\tAcme\tSenior Staff Data Platform Engineer\tEvaluated\t4.9/5\t❌\t[2](reports/002-acme-2026-04-01.md)\tReq R_1499999 separate posting\n',
  }, { rows: `${upgradedRow}\n` });
  const siblingRows = dataRows(sibling.tracker);
  if (siblingRows.length === 2) {
    pass('sibling-req guard still fires after a merge upgrade (req number survived in Notes)');
  } else {
    fail(`sibling req folded into the upgraded row — req number was lost: ${siblingRows.join(' // ')}`);
  }
} catch (e) {
  fail(`merge-tracker Notes-preservation tests crashed: ${e.message}`);
}
