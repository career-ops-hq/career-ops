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
 * @param {{rows?: string, header?: string, keepWorkspace?: boolean, reuse?: object}} [opts] -
 *   Seed rows appended to the tracker header, or a replacement header (used to
 *   build a tracker whose table separator row is missing). `keepWorkspace`
 *   leaves the temp dir on disk and returns it, and `reuse` runs against a
 *   workspace a previous call kept, so a test can genuinely re-run the SAME
 *   pending TSVs after repairing the tracker rather than starting fresh.
 * @returns {{tracker: string, output: string, exitCode: number, archived: string[], pending: string[], work?: string}}
 */
function runMergeDetailed(additions, opts = {}) {
  const work = opts.reuse?.work ?? mkdtempSync(join(tmpdir(), 'cops-merge-'));
  try {
    const tracker = join(work, 'applications.md');
    const addsDir = join(work, 'adds');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(tracker, (opts.header ?? TRACKER_HEADER) + (opts.rows ?? ''));
    // On a reused workspace the pending TSVs are already on disk from the
    // aborted run; rewriting them would defeat the point of replaying them.
    if (!opts.reuse) {
      for (const [name, line] of Object.entries(additions)) {
        writeFileSync(join(addsDir, name), line);
      }
    }
    let output = '';
    let exitCode = 0;
    let killedBy = null;
    try {
      output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8',
        timeout: 30000,
        // Capture stderr instead of letting execFileSync echo it: the
        // separator-row fixture below deliberately triggers a loud failure,
        // and its error text would otherwise land in the suite's own log.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
      });
    } catch (e) {
      output = String(e.stdout ?? '') + String(e.stderr ?? '');
      // A normal non-zero exit carries `status`; a kill (the 30s timeout, or
      // any other signal) carries `signal` with a null status. Collapsing both
      // to -1 would let a HUNG merge-tracker satisfy an `exitCode !== 0`
      // assertion, so the separator test would pass on a hang — the opposite
      // of what it checks. Surface the signal separately and let the caller
      // fail on it.
      if (typeof e.status === 'number') {
        exitCode = e.status;
      } else {
        killedBy = e.signal ?? 'unknown';
        exitCode = null;
      }
    }
    const mergedDir = join(addsDir, 'merged');
    return {
      tracker: readFileSync(tracker, 'utf-8'),
      output,
      exitCode,
      killedBy,
      archived: existsSync(mergedDir) ? readdirSync(mergedDir) : [],
      pending: readdirSync(addsDir).filter(f => f.endsWith('.tsv')),
      work: opts.keepWorkspace ? work : undefined,
    };
  } finally {
    if (!opts.keepWorkspace) rmSync(work, { recursive: true, force: true });
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

  // --- Re-evaluation write-through, both directions -----------------------
  // A re-evaluation that scores LOWER used to hit a bare `else`: the row kept
  // its stale optimistic score, the new report was orphaned, and the TSV was
  // archived to merged/ as though it had landed.
  const SEED = '| 7 | 2026-02-01 | Initech | Payments PM | 3.8/5 | Evaluated | ✅ | '
    + '[7](../reports/7-initech-2026-02-01.md) | Req R5639. stretch apply |\n';

  const down = runMergeDetailed({
    '8-initech.tsv': '8\t2026-03-01\tInitech\tPayments PM\tEvaluated\t3.0/5\t✅\t[8](reports/8-initech-2026-03-01.md)\tre-scored: req is 12 months old, rails gap is a gate\n',
  }, { rows: SEED });
  const downRow = down.tracker.split('\n').find(l => /\bInitech\b/.test(l)) || '';

  if (/\|\s*3\.0\/5\s*\|/.test(downRow) && !/\|\s*3\.8\/5\s*\|/.test(downRow)) {
    pass('re-evaluation with a LOWER score writes through (no silent skip)');
  } else {
    fail(`lower-scored re-eval did not write through: ${downRow.trim()}`);
  }

  if (/\[8\]/.test(downRow) && !/\[7\]\(/.test(downRow)) {
    pass('downgrade re-points the Report link at the newer report');
  } else {
    fail(`downgrade left a stale report link: ${downRow.trim()}`);
  }

  // The fuzzy matcher can mis-pair genuinely different roles (role-matcher.mjs
  // drops "Senior" and short tokens), so a downgrade must stay recoverable.
  if (/Superseded report \[7\] \(was 3\.8\/5\)/.test(downRow)) {
    pass('downgrade records the superseded report number in Notes');
  } else {
    fail(`downgrade did not record the superseded report: ${downRow.trim()}`);
  }

  // mergeNotes() keeps the existing cell verbatim and FIRST (#2483), so the
  // seeded Req number — which this script's own sibling-req guard reads back —
  // must survive the downgrade rather than being overwritten by it.
  if (/Req R5639/.test(downRow)) {
    pass('downgrade preserves the existing Notes (req number still readable)');
  } else {
    fail(`downgrade discarded the existing Notes: ${downRow.trim()}`);
  }

  if (/DOWNGRADE/.test(down.output) && /🔽/.test(down.output)) {
    pass('downgrade is announced on stdout, not merged silently');
  } else {
    fail(`downgrade was not announced: ${down.output.trim()}`);
  }

  if (/🔄1 updated/.test(down.output) && /⏭️0 skipped/.test(down.output)) {
    pass('downgrade counts as an update, not a skip');
  } else {
    fail(`downgrade counters wrong: ${down.output.trim()}`);
  }

  // An upgrade must keep behaving exactly as before this change.
  const up = runMergeDetailed({
    '9-initech.tsv': '9\t2026-03-01\tInitech\tPayments PM\tEvaluated\t4.5/5\t✅\t[9](reports/9-initech-2026-03-01.md)\tre-scored up after JD refresh\n',
  }, { rows: SEED });
  const upRow = up.tracker.split('\n').find(l => /\bInitech\b/.test(l)) || '';

  if (/\|\s*4\.5\/5\s*\|/.test(upRow) && /Re-eval 2026-03-01 \(3\.8→4\.5\)/.test(upRow)) {
    pass('re-evaluation with a HIGHER score still writes through unchanged');
  } else {
    fail(`upgrade path regressed: ${upRow.trim()}`);
  }

  if (!/Superseded report/.test(upRow) && !/DOWNGRADE/.test(up.output)) {
    pass('upgrade does not add the superseded-report marker');
  } else {
    fail(`upgrade wrongly marked as a downgrade: ${upRow.trim()}`);
  }

  // Equal scores write through too: the notes and report link are still fresher
  // than what the row holds, and no superseded marker is warranted.
  const same = runMergeDetailed({
    '10-initech.tsv': '10\t2026-03-02\tInitech\tPayments PM\tEvaluated\t3.8/5\t✅\t[10](reports/10-initech-2026-03-02.md)\tsame score, fresher read\n',
  }, { rows: SEED });
  const sameRow = same.tracker.split('\n').find(l => /\bInitech\b/.test(l)) || '';

  if (/\[10\]/.test(sameRow) && /Re-eval 2026-03-02 \(3\.8→3\.8\)/.test(sameRow)
      && !/Superseded report/.test(sameRow) && /🔄1 updated/.test(same.output)) {
    pass('equal-scored re-evaluation writes through without a superseded marker');
  } else {
    fail(`equal-score re-eval mishandled: ${sameRow.trim()} | ${same.output.trim()}`);
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
  // snapshot. Since #2411 a lower-scored addition writes through rather than
  // being skipped, so what the stale snapshot would corrupt is no longer *which*
  // row survives but what the re-eval marker claims: against the parse-time
  // score this renders `(4.0→4.2)` and silently mis-states the history the row
  // is supposed to preserve. Asserting the marker keeps the original invariant
  // under test, on the behaviour that replaced the skip.
  const downgrade = runMergeDetailed({
    'a-001-acme.tsv': '1\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\thigh\n',
    'b-001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tlow\n',
  }, { rows: seeded });
  const downgradeRows = dataRows(downgrade.tracker);
  if (downgradeRows.length === 1
      && /4\.2\/5/.test(downgradeRows[0])
      && /Re-eval 2026-03-01 \(4\.7→4\.2\)/.test(downgradeRows[0])
      && /🔄2 updated/.test(downgrade.output)) {
    pass('a later lower-scored addition writes through against the CURRENT score, not the parse-time one');
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

// ── #2483: placeholder Notes collapse to the marker, not gain a separator ───
// mergeNotes() only collapsed empty/whitespace/bare-period cells. The tracker's
// own "no data" sentinels (`—` / `-` / `N/A` — the looksLikeScoreCell set minus
// the score-only DUP) stayed truthy after the trim, so a placeholder row came
// out of a score upgrade as `—. Re-eval …`, a separator the row never had.
console.log('\nmerge-tracker.mjs — placeholder Notes collapse on upgrade (#2483)');
try {
  for (const ph of ['—', '-', 'N/A']) {
    const row =
      '| 1 | 2026-01-01 | Acme | Staff Data Platform Engineer | 4.0/5 | Evaluated | ❌ | ' +
      `[1](reports/001-acme-2026-01-01.md) | ${ph} |\n`;
    const upgraded = runMergeDetailed({
      '001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tre-scored after JD refresh\n',
    }, { rows: row });
    const notes = (dataRows(upgraded.tracker)[0] || '').split('|').map(c => c.trim())[9] ?? '';
    if (notes === 'Re-eval 2026-03-01 (4→4.7): re-scored after JD refresh') {
      pass(`placeholder Notes "${ph}" collapses to the marker alone`);
    } else {
      fail(`placeholder "${ph}" leaked into the merged Notes: "${notes}"`);
    }
  }
} catch (e) {
  fail(`merge-tracker placeholder-notes tests crashed: ${e.message}`);
}

// ── #2394: a tracker with no separator row dropped everything, silently ─────
// The insert point comes from SEPARATOR_ROW_RE. With no match, insertIdx
// stayed -1, the splice was skipped with no else, and the run went on to write
// the file, archive every TSV into merged/ and print "+N added". The
// evaluations existed only in merged/ afterwards.
console.log('\nmerge-tracker.mjs — tracker with no table separator row (#2394)');
try {
  const ADDITION = '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-03-01.md)\tonly evaluation\n';
  const broken = runMergeDetailed(
    { '001-acme.tsv': ADDITION },
    { header: '# Applications Tracker\n\n', keepWorkspace: true },
  );

  // exitCode is null when the child was killed rather than exiting, so a hung
  // merge cannot masquerade as the loud failure this asserts.
  if (broken.killedBy) {
    fail(`merge-tracker was killed by ${broken.killedBy} instead of exiting`);
  } else if (broken.exitCode !== 0) {
    pass('merge fails loudly when the tracker table has no separator row');
  } else {
    fail(`merge reported success against a separator-less tracker (exit ${broken.exitCode})`);
  }

  // The consequence that actually costs data: an archived TSV whose row never
  // reached the tracker is unrecoverable, because the tracker is gitignored.
  if (broken.archived.length === 0 && broken.pending.includes('001-acme.tsv')) {
    pass('the unmerged TSV stays in the additions dir instead of being archived');
  } else {
    fail(`TSV archived despite never reaching the tracker: archived=[${broken.archived.join(', ')}] pending=[${broken.pending.join(', ')}]`);
  }

  if (!/\+1 added/.test(broken.output) && /separator row/.test(broken.output)) {
    pass('the failure names the missing separator row rather than reporting rows added');
  } else {
    fail(`merge misreported the outcome: ${broken.output.split('\n').filter(l => /added|Summary/.test(l)).join(' // ') || '(no summary line)'}`);
  }

  // The abort promises the run "replays cleanly once the table is repaired", so
  // replay it literally: same workspace, same TSV left on disk by the aborted
  // run, only the tracker header repaired. Merging a fresh copy into a fresh
  // workspace would prove nothing about the pending file the user still has.
  try {
    const repaired = runMergeDetailed({}, { reuse: broken, keepWorkspace: true });
    if (repaired.killedBy) {
      fail(`replay was killed by ${repaired.killedBy} instead of exiting`);
    } else if (dataRows(repaired.tracker).length === 1 && repaired.exitCode === 0) {
      pass('the TSV left pending by the abort merges on replay once the header is repaired');
    } else {
      fail(`pending addition did not merge after header repair (exit ${repaired.exitCode}, rows ${dataRows(repaired.tracker).length})`);
    }
    if (repaired.archived.includes('001-acme.tsv') && repaired.pending.length === 0) {
      pass('the replayed TSV is archived once it has actually landed in the tracker');
    } else {
      fail(`replay left the TSV unarchived: archived=[${repaired.archived.join(', ')}] pending=[${repaired.pending.join(', ')}]`);
    }
  } finally {
    rmSync(broken.work, { recursive: true, force: true });
  }
} catch (e) {
  fail(`merge-tracker separator-row tests crashed: ${e.message}`);
}

// ── Non-Latin company names must not collapse into one row ──────────────────
// normalizeCompany() strips everything outside [a-z0-9], so every CJK /
// Cyrillic / Arabic company name normalizes to '' and all of them compared
// equal. With same-run rows registered in existingApps, tier-3 (empty company
// key + fuzzy role) folded DIFFERENT companies posting the same role in one
// batch into a single row. companiesMatch() falls back to raw equality when
// the normalized key is empty.
console.log('\nmerge-tracker.mjs — non-Latin company names stay distinct');
try {
  const twoCompanies = runMergeDetailed({
    '030-zeta.tsv': '30\t2026-02-01\t株式会社ゼータ\tデータエンジニア\tEvaluated\t4.2/5\t❌\t[30](reports/030-zeta-2026-02-01.md)\tzeta eval\n',
    '031-omega.tsv': '31\t2026-02-02\t合同会社オメガ\tデータエンジニア\tEvaluated\t4.6/5\t❌\t[31](reports/031-omega-2026-02-02.md)\tomega eval\n',
  });
  const twoCompanyRows = dataRows(twoCompanies.tracker);
  if (twoCompanyRows.length === 2 && /株式会社ゼータ/.test(twoCompanies.tracker) && /合同会社オメガ/.test(twoCompanies.tracker)) {
    pass('two distinct Japanese companies with the same role produce two rows');
  } else {
    fail(`non-Latin companies collapsed: ${twoCompanyRows.length} row(s): ${twoCompanyRows.join(' // ')}`);
  }

  // Control: dedup must still fire for the SAME non-Latin company — raw
  // equality replaces the empty key, it does not disable duplicate detection.
  const sameCompany = runMergeDetailed({
    '040-zeta.tsv': '40\t2026-02-01\t株式会社ゼータ\tデータエンジニア\tEvaluated\t4.2/5\t❌\t[40](reports/040-zeta-2026-02-01.md)\tfirst pass\n',
    '041-zeta.tsv': '41\t2026-02-02\t株式会社ゼータ\tデータエンジニア\tEvaluated\t4.6/5\t❌\t[41](reports/041-zeta-2026-02-02.md)\tsecond pass\n',
  });
  const sameCompanyRows = dataRows(sameCompany.tracker);
  if (sameCompanyRows.length === 1 && /4\.6\/5/.test(sameCompanyRows[0])) {
    pass('the same Japanese company twice still dedups to one row (higher score kept)');
  } else {
    fail(`same non-Latin company did not dedup: ${sameCompanyRows.join(' // ')}`);
  }
} catch (e) {
  fail(`merge-tracker non-Latin company tests crashed: ${e.message}`);
}

// ── mergeNotes: a new note that is a substring of an old clause must land ───
// The repeat check was a raw prev.includes(incoming): existing
// "Applied 2026-01-15. Remote OK" swallowed an incoming "Remote" outright.
// Repeats are now judged per '. '-separated clause.
console.log('\nmerge-tracker.mjs — substring notes survive a score upgrade');
try {
  const REMOTE_ROW =
    '| 1 | 2026-01-01 | Acme | Staff Data Platform Engineer | 4.0/5 | Applied | ❌ | ' +
    '[1](reports/001-acme-2026-01-01.md) | Applied 2026-01-15. Remote OK |\n';
  const substringNote = runMergeDetailed({
    '001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tRemote\n',
  }, { rows: REMOTE_ROW });
  const substringRow = dataRows(substringNote.tracker)[0] || '';
  if (/Remote OK/.test(substringRow) && /\(4→4\.7\): Remote\s*\|/.test(substringRow)) {
    pass('an incoming note that is a substring of an existing clause is still appended');
  } else {
    fail(`substring note was dropped: ${substringRow}`);
  }

  // Control: an incoming note IDENTICAL to an existing clause is a genuine
  // repeat — the marker is recorded, the text is not duplicated.
  const repeatNote = runMergeDetailed({
    '001-acme.tsv': '1\t2026-03-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.7/5\t❌\t[1](reports/001-acme-2026-01-01.md)\tRemote OK\n',
  }, { rows: REMOTE_ROW });
  const repeatRow = dataRows(repeatNote.tracker)[0] || '';
  const remoteOkCount = (repeatRow.match(/Remote OK/g) || []).length;
  if (remoteOkCount === 1 && /Re-eval 2026-03-01/.test(repeatRow)) {
    pass('an incoming note identical to an existing clause is not duplicated');
  } else {
    fail(`clause-level repeat detection failed (${remoteOkCount} copies): ${repeatRow}`);
  }
} catch (e) {
  fail(`merge-tracker substring-note tests crashed: ${e.message}`);
}

// ── Same-run num collisions: distinct roles must not fold into one row ──────
// Two TSVs that both claimed the same reserved num for DIFFERENT roles at one
// company are a reservation race, not a re-evaluation. Tier-2 (num + company)
// has no role check, so with same-run rows in existingApps the second TSV
// became an update candidate for the first — one row, first title, second
// score. Main renumbered and kept both (#1704/#1733); same-run tier-2 now
// requires a fuzzy role match too.
console.log('\nmerge-tracker.mjs — same-run num collision with distinct roles');
try {
  const collision = runMergeDetailed({
    '050-acme-a.tsv': '5\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[5](reports/005-acme-2026-02-01.md)\tplatform\n',
    '051-acme-b.tsv': '5\t2026-02-02\tAcme\tDirector of Product Marketing\tEvaluated\t4.6/5\t❌\t[6](reports/006-acme-2026-02-02.md)\tmarketing\n',
  });
  const collisionRows = dataRows(collision.tracker);
  if (collisionRows.length === 2
      && /Staff Data Platform Engineer/.test(collision.tracker)
      && /Director of Product Marketing/.test(collision.tracker)) {
    pass('two same-run TSVs sharing one num but distinct roles stay two rows');
  } else {
    fail(`same-run num collision folded distinct roles: ${collisionRows.join(' // ')}`);
  }
  // The renumber itself is the observable contract (#1704/#1733): the first
  // TSV keeps the contested num, the second gets the next free one. (The
  // accompanying "already used" warning goes to stderr, which the success-path
  // capture here does not see.)
  const marketingRow = collisionRows.find(r => /Director of Product Marketing/.test(r)) || '';
  if (/^\|\s*6\s*\|/.test(marketingRow) && collisionRows.some(r => /^\|\s*5\s*\|/.test(r))) {
    pass('the losing TSV of a same-run num collision is renumbered to the next free id');
  } else {
    fail(`same-run num collision was not renumbered: ${collisionRows.join(' // ')}`);
  }

  // Control: the same num AND the same role in one run is still one evaluation
  // re-emitted — it must keep deduping to a single row.
  const sameRoleCollision = runMergeDetailed({
    '060-acme-a.tsv': '7\t2026-02-01\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.2/5\t❌\t[7](reports/007-acme-2026-02-01.md)\tfirst pass\n',
    '061-acme-b.tsv': '7\t2026-02-02\tAcme\tStaff Data Platform Engineer\tEvaluated\t4.6/5\t❌\t[8](reports/008-acme-2026-02-02.md)\tsecond pass\n',
  });
  const sameRoleRows = dataRows(sameRoleCollision.tracker);
  if (sameRoleRows.length === 1 && /4\.6\/5/.test(sameRoleRows[0])) {
    pass('the same num with the same role in one run still dedups to one row');
  } else {
    fail(`same-run same-role collision mishandled: ${sameRoleRows.join(' // ')}`);
  }
} catch (e) {
  fail(`merge-tracker same-run num collision tests crashed: ${e.message}`);
}
