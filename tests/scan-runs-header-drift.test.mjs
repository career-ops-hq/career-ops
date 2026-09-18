// tests/scan-runs-header-drift.test.mjs
//
// SCAN_RUNS_HEADER is written by appendScanRunSummary only when the file does not yet exist, so a
// release that appends or inserts a counter leaves existing scan-runs.tsv files with a header that
// no longer describes the rows beneath it. computeRunStats reads by column NAME — deliberately, and
// its own comment says positional slicing "would silently miscount" — but that discipline assumes a
// header which still matches the writer, and nothing verified that assumption.
//
// The failure is quiet and it points the wrong way: a name lookup lands on a neighbouring counter,
// so the summary reports a confident, precise, wrong number rather than breaking visibly.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan-runs.tsv header drift (#3280)');
try {
  const { computeRunStats } = await import(pathToFileURL(join(ROOT, 'stats.mjs')).href);

  // A file created under an older header, with rows written after a counter was inserted.
  const header = 'timestamp\tstatus\tcompanies\tboards\tfound\tdupes\tnew_added\n';
  const widerRow = '2026-01-02T00:00:00Z\tcompleted\t5\t0\t100\t0\t7\t3\n';
  const matchingRow = '2026-01-01T00:00:00Z\tcompleted\t5\t0\t100\t0\t7\n';

  {
    const r = computeRunStats(header + matchingRow + widerRow);
    if (r.driftedRows === 1) pass('a row wider than the header is counted as drifted');
    else fail(`driftedRows = ${r.driftedRows}, expected 1`);
    if (r.totalRuns === 1) pass('the drifted row is excluded from the averages rather than misread');
    else fail(`totalRuns = ${r.totalRuns}, expected 1`);
  }

  {
    // Every row drifted. Returning null here would report an absent scan section on a file that is
    // full of rows — the reason has to survive.
    const r = computeRunStats(header + widerRow);
    if (r && r.driftedRows === 1 && r.totalRuns === 0) pass('an all-drifted file reports the drift instead of returning null');
    else fail(`all-drifted case returned ${JSON.stringify(r)}`);
  }

  {
    const r = computeRunStats(header + matchingRow);
    if (r.driftedRows === 0) pass('a file whose header matches reports no drift');
    else fail(`driftedRows = ${r.driftedRows} on a matching file`);
    if (r.avgNewPerRun === 7) pass('a matching file still computes its averages normally');
    else fail(`avgNewPerRun = ${r.avgNewPerRun}, expected 7`);
  }

  {
    // The all-drifted result must not carry a null lastRunDate into the summary template, which
    // would render `Runs: 0 recorded (last null)` and read as an empty file rather than an
    // unreadable one.
    const r = computeRunStats(header + widerRow);
    if (r.lastRunDate === null && r.totalRuns === 0 && r.driftedRows > 0) {
      pass('the all-drifted result is distinguishable from an empty file (totalRuns 0 + driftedRows > 0)');
    } else {
      fail(`all-drifted shape was ${JSON.stringify(r)}`);
    }
  }

  {
    // Narrow rows keep their existing treatment — this must not change.
    const r = computeRunStats(header + '2026-01-03T00:00:00Z\tcompleted\t5\n');
    if (r === null || r.totalRuns === 0) pass('a torn (too narrow) row is still skipped as before');
    else fail(`torn row was counted: ${JSON.stringify(r)}`);
  }
} catch (err) {
  fail(`header-drift suite threw: ${err.message}`);
}
