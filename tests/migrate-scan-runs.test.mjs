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
const { migrateScanRuns, schemasByWidth, CURRENT_COLUMNS } = await load('migrate-scan-runs.mjs');
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
  const before = [GEN14.join('\t'), numRow(GEN14, 1, 10, 2), numRow(GEN14, 2, 20, 4)].join('\n') + '\n';
  // Control: the whole point is that the reader excludes these rows TODAY. If
  // it already counted them, every assertion below would be vacuous.
  const statsBefore = computeRunStats(before.replace(GEN14.join('\t'), CURRENT.join('\t')));
  if (!statsBefore || statsBefore.totalRuns === 0) {
    pass('control: stats excludes pre-drift rows before the migration');
  } else {
    fail(`control failed: stats already counted ${statsBefore.totalRuns} rows, so the fix proves nothing`);
  }

  const after = computeRunStats(migrateScanRuns(before).text);
  if (after && after.totalRuns === 2 && after.avgFoundPerRun === 15 && after.avgNewPerRun === 3) {
    pass('stats folds the recovered rows after migration (2 runs, avg found 15, avg new 3)');
  } else {
    fail(`stats did not recover the rows: ${JSON.stringify(after)}`);
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
