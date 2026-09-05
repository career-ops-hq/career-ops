// tests/openrouter-tracker-tsv.test.mjs — an openrouter-produced tracker-addition
// TSV must merge into applications.md.
//
// History, because this file's assertions were inverted by #3517 and the reason
// matters. openrouter-runner used to write a "num\tdate\t…\n" header line ahead
// of the data row while merge-tracker read the whole addition file as ONE record
// (no line split), so parts[4]/parts[5] were the literal "status"/"score",
// resolveScoreStatus returned null, and EVERY openrouter evaluation was skipped.
// The fix then was to drop the header, and this test pinned that: header present
// → row skipped.
//
// #3517 made the header the MEANINGFUL form instead of the broken one. merge
// -tracker now splits the file into lines, and a leading row of column LABELS is
// resolved by name, which is what removes the score/status ambiguity at its
// source rather than working around it. So the second leg below asserts the
// opposite of what it once did, and the source guard asserts the header IS
// written. The first leg is unchanged: headerless files stay supported forever.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nopenrouter-runner.mjs — tracker-addition TSV merges (headed and headerless)');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

// Assert PLACEMENT, not presence. `/Evaluated/.test(row) && /4\.0\/5/.test(row)`
// passes on a transposed merge too — both literals are still somewhere in the
// row string — so those regexes could not tell a by-name merge from the exact
// positional swap this file exists to guard (verified by injecting the swap:
// the old assertions stayed green). The addition writes status BEFORE score
// while the tracker shows score BEFORE status, which is the whole trap, so the
// cells have to be compared one by one.
//
// Indices are read from the fixture's own header rather than hard-coded, so
// editing TRACKER_HEADER cannot silently unbind the assertions from it.
const HEADER_CELLS = TRACKER_HEADER.split('\n').find((l) => l.startsWith('|')).split('|').map((c) => c.trim());
const SCORE_COL = HEADER_CELLS.indexOf('Score');
const STATUS_COL = HEADER_CELLS.indexOf('Status');

/** The merged row for #35, split into trimmed cells. */
function mergedRow(markdown) {
  const row = markdown.split('\n').find((l) => /^\|\s*35\s*\|/.test(l));
  return { row, cells: row ? row.split('|').map((c) => c.trim()) : [] };
}

/** True when score and status each sit in their OWN tracker column. */
function landedInOwnColumns(cells) {
  return cells[SCORE_COL] === '4.0/5' && cells[STATUS_COL] === 'Evaluated';
}

if (SCORE_COL > 0 && STATUS_COL > 0) {
  pass('fixture header exposes the Score and Status columns the assertions bind to');
} else {
  fail(`fixture header lost its Score/Status labels (score=${SCORE_COL}, status=${STATUS_COL}) — the column assertions below would be vacuous`);
}

// The exact shape openrouter-runner writes (openrouter-runner.mjs `tsvLine`):
// num, date, company, "(see report)", status, score, pdf, report-link, notes.
const num = 35, today = '2026-08-09', slug = 'acme-corp';
const company = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const link = `[0${num}](reports/0${num}-${slug}-${today}.md)`;
const dataLine = `${num}\t${today}\t${company}\t(see report)\tEvaluated\t4.0/5\t❌\t${link}\t\n`;

const work = mkdtempSync(join(tmpdir(), 'cops-or-tsv-'));
try {
  const tracker = join(work, 'applications.md');
  const addsDir = join(work, 'adds');
  mkdirSync(addsDir, { recursive: true });
  writeFileSync(tracker, TRACKER_HEADER);
  writeFileSync(join(addsDir, `or-0${num}-${slug}.tsv`), dataLine);

  let output = '';
  try {
    output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir },
    });
  } catch (e) {
    output = String(e.stdout ?? '') + String(e.stderr ?? '');
  }

  const { row, cells } = mergedRow(readFileSync(tracker, 'utf-8'));
  if (row && /Acme Corp/.test(row) && landedInOwnColumns(cells)) {
    pass('headerless TSV row merges with score and status in their own columns');
  } else {
    fail(`headerless row not merged correctly. score cell="${cells[SCORE_COL]}" status cell="${cells[STATUS_COL]}" | output: ${output.trim().split('\n').pop()} | tracker row: ${row ?? '(none)'}`);
  }

  // The headed form — the one openrouter writes now — merges, by name (#3517).
  // This assertion used to be its inverse ("header-prefixed TSV is correctly
  // skipped"), which was the bug's symptom pinned as the contract.
  const work2 = mkdtempSync(join(tmpdir(), 'cops-or-hdr-'));
  try {
    const t2 = join(work2, 'applications.md');
    const a2 = join(work2, 'adds');
    mkdirSync(a2, { recursive: true });
    writeFileSync(t2, TRACKER_HEADER);
    writeFileSync(join(a2, `or-0${num}-${slug}.tsv`), `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n${dataLine}`);
    let out2 = '';
    try {
      out2 = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CAREER_OPS_TRACKER: t2, CAREER_OPS_ADDITIONS: a2 },
      });
    } catch (e) { out2 = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    const { row: row2, cells: cells2 } = mergedRow(readFileSync(t2, 'utf-8'));
    if (row2 && /Acme Corp/.test(row2) && landedInOwnColumns(cells2)) {
      pass('headed TSV merges with score and status resolved by label into their own columns');
    } else {
      fail(`headed TSV did not merge correctly. score cell="${cells2[SCORE_COL]}" status cell="${cells2[STATUS_COL]}" | output: ${out2.trim().split('\n').pop()} | tracker row: ${row2 ?? '(none)'}`);
    }
  } finally {
    try { rmSync(work2, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // Inverse case: prove the oracle above actually DISCRIMINATES, rather than
  // being satisfied by any row carrying both literals. Built as two row strings
  // — one correct, one transposed — so it is deterministic and needs no injected
  // bug in merge-tracker to demonstrate. If landedInOwnColumns() is ever
  // loosened back toward substring presence, this reddens on the spot, which is
  // what keeps the two legs above from quietly going vacuous again.
  const correctRow = `| 35 | ${today} | Acme Corp | (see report) | 4.0/5 | Evaluated | ❌ | ${link} |  |`;
  const transposedRow = `| 35 | ${today} | Acme Corp | (see report) | Evaluated | 4.0/5 | ❌ | ${link} |  |`;
  const cellsFor = (line) => line.split('|').map((c) => c.trim());
  if (landedInOwnColumns(cellsFor(correctRow)) && !landedInOwnColumns(cellsFor(transposedRow))) {
    pass('the column assertion accepts the correct row and rejects the transposed one');
  } else {
    fail('the column assertion does not discriminate a transposed row — the legs above are vacuous');
  }

  // Guard: the source must WRITE the header, from the shared constant. The old
  // guard searched for the literal `num\tdate\tcompany\trole\tstatus` in the
  // source and would now pass vacuously either way, since the labels live in
  // tracker-parse.mjs's TSV_ADDITION_HEADER rather than in a string here.
  const src = readFileSync(join(ROOT, 'openrouter-runner.mjs'), 'utf-8');
  const importsHeader = /import\s*\{[^}]*\bTSV_ADDITION_HEADER\b[^}]*\}\s*from\s*'\.\/tracker-parse\.mjs'/.test(src);
  const writesHeader = /writeFile\(\s*tsvFile\s*,\s*`\$\{TSV_ADDITION_HEADER\}/.test(src);
  if (importsHeader && writesHeader) {
    pass('openrouter-runner.mjs writes the shared header row above the data line');
  } else {
    fail(`openrouter-runner.mjs must write TSV_ADDITION_HEADER above the data row (imports=${importsHeader}, writes=${writesHeader})`);
  }
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
}
