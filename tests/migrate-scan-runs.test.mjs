/**
 * migrate-scan-runs.mjs (#4423).
 *
 * appendScanRunSummary writes the header only when the file does not exist, so
 * a release that inserts or appends a counter leaves every existing
 * data/scan-runs.tsv described by a header that no longer matches its rows.
 * computeRunStats then drops those rows entirely — wider rows as drift, narrow
 * ones as torn — and the file is append-only, so that history cannot be
 * regenerated.
 *
 * The payoff assertion is the computeRunStats round trip near the end: rows
 * that the reader excluded before the migration are counted after it. Without
 * it, every other assertion here could pass on a migration that produced a
 * tidy file the reader still refuses.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

// pathToFileURL, not a bare absolute path: on Windows "C:\\..." is not a valid
// URL scheme and dynamic import rejects it. Windows is one of the three CI
// platforms, so a bare path fails there and nowhere a local run would show it.
const load = (m) => import(pathToFileURL(join(ROOT, m)).href);
const { migrateScanRuns, schemasByWidth, CURRENT_COLUMNS, writeMigrated } = await load('migrate-scan-runs.mjs');
const { computeRunStats } = await load('stats.mjs');
const { SCAN_RUNS_HEADER } = await load('scan.mjs');

const CURRENT = SCAN_RUNS_HEADER.trim().split('\t');

// The real schema generations, oldest first, recovered from the history of
// SCAN_RUNS_HEADER in scan.mjs. Only ONE of these steps was an insertion
// (filtered_posting_age at index 8); the rest appended. Widths 14..19 are
// distinct, which is what makes per-row width a usable schema key.
const GEN14 = ['timestamp', 'status', 'companies', 'boards', 'found', 'filtered_title',
  'filtered_tier', 'filtered_location', 'filtered_salary', 'filtered_content',
  'filtered_cooldown', 'dupes', 'new_added', 'errors'];

/** Build a row under `cols` whose every cell is "<name>=<n>" so a misplaced column is visible. */
const rowFor = (cols, n) => cols.map((c) => (c === 'timestamp' ? `2026-07-0${n}T00:00:00Z`
  : c === 'status' ? 'completed' : `${c}=${n}`)).join('\t');

/** Same, but with real numbers, so computeRunStats can actually fold it. */
const numRow = (cols, day, found, newAdded) => cols.map((c) => (
  c === 'timestamp' ? `2026-07-${String(day).padStart(2, '0')}T00:00:00Z`
    : c === 'status' ? 'completed'
      : c === 'found' ? String(found)
        : c === 'new_added' ? String(newAdded)
          : '0')).join('\t');

console.log('\n🧪 Testing migrate-scan-runs (#4423)...');

// ---------------------------------------------------------------- schema table
{
  const byWidth = schemasByWidth();
  // Generations 15..N are DERIVED as prefixes of the current header, which is
  // only valid because every change after the one insertion appended. Assert
  // both halves: that width 14 really is not a prefix (so its entry earns its
  // keep) and that the derived widths are contiguous up to the current one.
  const gen14 = byWidth.get(14);
  if (gen14 && gen14.join('\t') !== CURRENT_COLUMNS.slice(0, 14).join('\t')) {
    pass('schema table keeps width 14 explicit, because it is the one insertion and not a prefix');
  } else {
    fail('width 14 is being treated as a prefix of the current header; the insertion would be lost');
  }
  const widths = [...byWidth.keys()].sort((a, b) => a - b);
  if (widths[0] === 14 && widths.at(-1) === CURRENT_COLUMNS.length
      && widths.length === CURRENT_COLUMNS.length - 13) {
    pass(`schema table covers every width from 14 to ${CURRENT_COLUMNS.length} with no gaps`);
  } else {
    fail(`schema table has gaps: ${JSON.stringify(widths)}`);
  }
}

// ---------------------------------------------------------------- oldest schema
{
  const before = [GEN14.join('\t'), rowFor(GEN14, 1), rowFor(GEN14, 2)].join('\n') + '\n';
  const out = migrateScanRuns(before);

  if (out.text.split('\n')[0] === CURRENT.join('\t')) {
    pass('migrate rewrites a 14-column header to the current one');
  } else {
    fail(`header not migrated: ${out.text.split('\n')[0]}`);
  }

  const cells = out.text.split('\n')[1].split('\t');
  const at = (name) => cells[CURRENT.indexOf(name)];
  // Every counter the old schema recorded has to land under its OWN name, not
  // at its old position. filtered_salary is the one that moves: index 8 -> 9.
  if (at('filtered_salary') === 'filtered_salary=1' && at('filtered_content') === 'filtered_content=1'
      && at('errors') === 'errors=1' && at('found') === 'found=1') {
    pass('migrate remaps every old counter by NAME, so the inserted column does not shift them');
  } else {
    fail(`counters misplaced after migration: ${JSON.stringify(cells)}`);
  }

  if (at('filtered_posting_age') === '') {
    pass('migrate leaves a counter the old schema never recorded empty, never a fabricated 0');
  } else {
    fail(`filtered_posting_age should be empty, got ${JSON.stringify(at('filtered_posting_age'))}`);
  }

  if (cells.length === CURRENT.length) {
    pass('migrated rows are exactly as wide as the current header');
  } else {
    fail(`row width ${cells.length} != header width ${CURRENT.length}`);
  }

  // Idempotence: the file is append-only and a second run must not double-apply.
  const again = migrateScanRuns(out.text);
  if (again.text === out.text) {
    pass('migrate is idempotent — re-running it is a byte-for-byte no-op');
  } else {
    fail('second migration changed the file again');
  }
}

// ---------------------------------------------------------------- already current
{
  const current = [CURRENT.join('\t'), rowFor(CURRENT, 1)].join('\n') + '\n';
  const out = migrateScanRuns(current);
  if (out.text === current && out.migratedRows === 0) {
    pass('control: a file already on the current schema is left byte-for-byte alone');
  } else {
    fail(`current-schema file was rewritten: migrated=${out.migratedRows}`);
  }
}

// ---------------------------------------------------------------- mixed widths
{
  // Rows written by different releases coexist in one append-only file, so the
  // schema is a property of the ROW, not of the header.
  const GEN16 = [...GEN14.slice(0, 8), 'filtered_posting_age', ...GEN14.slice(8), 'filtered_blacklist'];
  const before = [GEN14.join('\t'), rowFor(GEN14, 1), rowFor(GEN16, 2)].join('\n') + '\n';
  const out = migrateScanRuns(before);
  const lines = out.text.trim().split('\n');
  const cellsOf = (i) => lines[i].split('\t');
  const at = (i, name) => cellsOf(i)[CURRENT.indexOf(name)];
  if (at(1, 'filtered_salary') === 'filtered_salary=1' && at(2, 'filtered_blacklist') === 'filtered_blacklist=2'
      && at(2, 'filtered_posting_age') === 'filtered_posting_age=2' && at(1, 'filtered_posting_age') === '') {
    pass('migrate keys each row on its OWN width, so rows from different releases coexist');
  } else {
    fail(`mixed-width file migrated wrong: ${JSON.stringify(lines)}`);
  }
}

// ---------------------------------------------------------------- unknown width
{
  const weird = [GEN14.join('\t'), rowFor(GEN14, 1), 'a\tb\tc'].join('\n') + '\n';
  const out = migrateScanRuns(weird);
  const lines = out.text.trim().split('\n');
  if (lines[2] === 'a\tb\tc' && out.passedThrough === 1) {
    pass('migrate passes a row of unrecognized width through untouched and reports it');
  } else {
    fail(`unknown-width row was guessed at: ${JSON.stringify(lines[2])} passedThrough=${out.passedThrough}`);
  }
}

// ---------------------------------------------------------------- CRLF
{
  // A CRLF file leaves the CR on the LAST cell of each row. Remapping moves that
  // cell into the middle of the row, so without normalization the migrated line
  // carries a CR in its interior — valid-looking, and wrong.
  const before = [GEN14.join('\t'), rowFor(GEN14, 1)].join('\r\n') + '\r\n';
  const out = migrateScanRuns(before);
  const cells = out.text.split('\n')[1].split('\t');
  const errorsCell = cells[CURRENT.indexOf('errors')];
  if (errorsCell === 'errors=1' && !out.text.includes('\r')) {
    pass('migrate normalizes CRLF, so no carriage return is stranded inside a migrated row');
  } else {
    fail(`CRLF leaked into the row: errors=${JSON.stringify(errorsCell)}`);
  }
}

// ------------------------------------------------- the payoff: stats sees them
{
  // ONE file for both readings. The earlier version of this block measured the
  // control against a DIFFERENT file (the same rows under a fabricated current
  // header) and then migrated the original, whose 14-column rows matched their
  // own 14-column header and were therefore already counted. computeRunStats
  // returned totalRuns 2 on the un-migrated file, so the payoff assertion
  // proved nothing at all.
  //
  // The drift that actually loses history is a STALE header with a LATER, wider
  // row beneath it: the file was created by an old release and kept being
  // appended to by newer ones. computeRunStats counts that row as drift and
  // excludes it.
  const before = [
    GEN14.join('\t'),            // stale 14-column header
    numRow(GEN14, 1, 10, 2),     // a row from that era — still countable
    numRow(CURRENT, 2, 20, 4),   // a row a later release appended — excluded
  ].join('\n') + '\n';

  const statsBefore = computeRunStats(before);
  if (statsBefore && statsBefore.totalRuns === 1 && statsBefore.driftedRows === 1) {
    pass('control: stats excludes the wider row as drift before the migration');
  } else {
    fail(`control failed: expected 1 counted + 1 drifted, got ${JSON.stringify(statsBefore)}`);
  }

  const after = computeRunStats(migrateScanRuns(before).text);
  if (after && after.totalRuns === 2 && after.driftedRows === 0
      && after.avgFoundPerRun === 15 && after.avgNewPerRun === 3) {
    pass('stats folds the recovered row after migration (2 runs, no drift, avg found 15)');
  } else {
    fail(`stats did not recover the drifted row: ${JSON.stringify(after)}`);
  }
}

// ------------------------------------------- the write refuses a stale swap
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-msr-cas-'));
  try {
    const file = join(dir, 'scan-runs.tsv');
    const snapshot = [GEN14.join('\t'), rowFor(GEN14, 1)].join('\n') + '\n';

    // A scan appended a run after the migration read its snapshot. Writing the
    // migrated text now would erase that run, and neither the .bak (which holds
    // the same snapshot) nor an atomic replace would bring it back.
    writeFileSync(file, `${snapshot}${rowFor(GEN14, 2)}\n`, 'utf-8');
    const onDisk = readFileSync(file, 'utf-8');
    const refused = await writeMigrated(file, snapshot, 'MIGRATED');

    if (!refused.written && readFileSync(file, 'utf-8') === onDisk) {
      pass('writeMigrated refuses a file that changed since it was read, leaving it untouched');
    } else {
      fail(`stale swap was written: ${JSON.stringify(refused)}`);
    }
    if (!existsSync(`${file}.bak`)) {
      pass('a refused write leaves no .bak, so nothing suggests it ran');
    } else {
      fail('a refused write still created a .bak');
    }

    // Control: the same call succeeds when the file is untouched. Without it,
    // "refuses" is indistinguishable from "never writes at all".
    writeFileSync(file, snapshot, 'utf-8');
    const ok = await writeMigrated(file, snapshot, 'MIGRATED');
    if (ok.written && readFileSync(file, 'utf-8') === 'MIGRATED'
        && readFileSync(`${file}.bak`, 'utf-8') === snapshot) {
      pass('control: writeMigrated replaces the file and backs up the snapshot when it is unchanged');
    } else {
      fail(`unchanged file was not written: ${JSON.stringify(ok)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- CLI contract
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-msr-'));
  try {
    const file = join(dir, 'scan-runs.tsv');
    const before = [GEN14.join('\t'), rowFor(GEN14, 1)].join('\n') + '\n';
    writeFileSync(file, before, 'utf-8');

    const dry = spawnSync(NODE, [join(ROOT, 'migrate-scan-runs.mjs'), '--file', file], { encoding: 'utf-8' });
    if (dry.status === 0 && readFileSync(file, 'utf-8') === before && !existsSync(`${file}.bak`)) {
      pass('CLI dry run is the default: it reports, writes nothing, and leaves no .bak');
    } else {
      fail(`dry run wrote to disk: status=${dry.status}\n${dry.stdout}${dry.stderr}`);
    }

    const applied = spawnSync(NODE, [join(ROOT, 'migrate-scan-runs.mjs'), '--file', file, '--apply'], { encoding: 'utf-8' });
    const nowText = readFileSync(file, 'utf-8');
    if (applied.status === 0 && nowText.split('\n')[0] === CURRENT.join('\t')) {
      pass('CLI --apply migrates the file in place');
    } else {
      fail(`--apply did not migrate: status=${applied.status}\n${applied.stdout}${applied.stderr}`);
    }
    if (existsSync(`${file}.bak`) && readFileSync(`${file}.bak`, 'utf-8') === before) {
      pass('CLI --apply writes the original beside the file as .bak before replacing it');
    } else {
      fail('no .bak, or .bak does not hold the original text');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------- the write waits for the scanner's lock
//
// The compare alone left a window: it proves nothing about what lands between
// the read and the rename. Measured at about 9ms, and reproduced at 48 lost
// rows over 120 trials, every one reporting written: true and exiting 0.
//
// Holding the lock here stands in for a scan that is mid-append. The migration
// must not replace a file it could not lock. On the compare-only version it
// does: writeMigrated ignores the lock entirely, returns written: true, and the
// file is already gone by the time the scanner writes its row.
//
// No mkfifo and no timing race, so this runs the same on Windows CI.
{
  const { acquirePipelineLock } = await load('pipeline-lock.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-msr-lock-'));
  try {
    const file = join(dir, 'scan-runs.tsv');
    const snapshot = [GEN14.join('\t'), rowFor(GEN14, 1)].join('\n') + '\n';
    writeFileSync(file, snapshot, 'utf-8');

    const held = await acquirePipelineLock(file, { timeoutMs: 2_000 });
    let outcome = null;
    let threw = null;
    try {
      outcome = await writeMigrated(file, snapshot, 'MIGRATED', { timeoutMs: 150 });
    } catch (err) {
      threw = err;
    } finally {
      await held.release();
    }

    if (readFileSync(file, 'utf-8') === snapshot) {
      pass('writeMigrated leaves the file untouched while the scanner holds the lock');
    } else {
      fail(`migration replaced a file it could not lock: outcome=${JSON.stringify(outcome)} threw=${threw && threw.name}`);
    }
    if (!existsSync(`${file}.bak`)) {
      pass('and it wrote no .bak, so nothing suggests the swap ran');
    } else {
      fail('a lock-blocked write still created a .bak');
    }

    // Control: the same call succeeds once the lock is free. Without it,
    // "waits for the lock" is indistinguishable from "never writes at all".
    const free = await writeMigrated(file, snapshot, 'MIGRATED');
    if (free.written && readFileSync(file, 'utf-8') === 'MIGRATED') {
      pass('control: the same write succeeds once the lock is released');
    } else {
      fail(`unlocked write did not land: ${JSON.stringify(free)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
