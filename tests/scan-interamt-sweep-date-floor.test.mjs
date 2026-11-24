// tests/scan-interamt-sweep-date-floor.test.mjs — a partial Interamt sweep
// never advances the next run's date floor.
//
// scan-interamt.mjs flushes scan-history rows after EACH keyword so a kill
// mid-sweep keeps what it already found (#7608). But loadLastScanDate() used
// to derive the next run's "already scanned through" floor from the max
// first_seen date among interamt rows on disk. A run that dies after keyword
// 1 of N already has today's date on those rows, so the next run's floor
// silently jumped to today even though keywords 2..N were never searched —
// postings under those keywords published before today would be skipped as
// stale. The fix: the floor now lives in a dedicated marker written only
// once a run has attempted every configured keyword; a partial run never
// reaches that write, so the floor stays where the last full sweep left it.
//
// Runs in a child process: scan-interamt.mjs reads getCareerOpsRoot() and
// SCAN_HISTORY_PATH at import time, and other suites in the same process may
// already have those baked in from a different fixture root.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';

console.log('\nscan-interamt sweep-date floor — a partial sweep does not advance it');

const root = mkdtempSync(join(tmpdir(), 'career-ops-interamt-sweep-'));
mkdirSync(join(root, 'data'), { recursive: true });

const LAST_SWEEP = '2026-11-20';
const PARTIAL_RUN_DATE = '2026-11-23';

writeFileSync(join(root, 'data', 'interamt-sweep-state.json'), JSON.stringify({ lastCompleteSweep: LAST_SWEEP }) + '\n');

// Scan-history row a crashed run (dead after keyword 1) would have flushed
// before dying — dated the day it ran, not the last complete sweep.
writeFileSync(join(root, 'data', 'scan-history.tsv'), [
  'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
  `https://interamt.de/koop/app/stelle?id=1\t${PARTIAL_RUN_DATE}\tinteramt\tReferent\tStadt\tadded`,
  '',
].join('\n'));

const probeSource = `
  const scan = await import(process.argv.at(-1));
  process.stdout.write(JSON.stringify({ lastScanDate: scan.loadLastScanDate()?.toISOString().slice(0, 10) ?? null }));
`;

try {
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  for (const name of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_SCAN_HISTORY']) delete env[name];
  const out = JSON.parse(execFileSync(NODE, [
    '--input-type=module', '-e', probeSource,
    pathToFileURL(join(ROOT, 'scan-interamt.mjs')).href,
  ], { env, encoding: 'utf8' }));

  if (out.lastScanDate === LAST_SWEEP) {
    pass(`a scan-history row from a partial run (dated ${PARTIAL_RUN_DATE}) does not move the floor past the last complete sweep (${LAST_SWEEP})`);
  } else {
    fail(`expected the floor to stay at ${LAST_SWEEP}, got ${out.lastScanDate}`);
  }

  // Now simulate a full sweep finishing: the marker should advance, and take
  // over from row-scanning entirely.
  const fullSweepSource = `
    const scan = await import(process.argv.at(-1));
    scan.recordSweepComplete('${PARTIAL_RUN_DATE}');
    process.stdout.write(JSON.stringify({ lastScanDate: scan.loadLastScanDate()?.toISOString().slice(0, 10) ?? null }));
  `;
  const out2 = JSON.parse(execFileSync(NODE, [
    '--input-type=module', '-e', fullSweepSource,
    pathToFileURL(join(ROOT, 'scan-interamt.mjs')).href,
  ], { env, encoding: 'utf8' }));

  if (out2.lastScanDate === PARTIAL_RUN_DATE) {
    pass(`recordSweepComplete() advances the floor once a run finishes every keyword`);
  } else {
    fail(`expected the floor to advance to ${PARTIAL_RUN_DATE} after a full sweep, got ${out2.lastScanDate}`);
  }

  // A --keyword run only ever searches one keyword, never the full
  // configured list, so shouldAdvanceSweepMarker() must refuse it even
  // outside --dry-run.
  const keywordRunSource = `
    const scan = await import(process.argv.at(-1));
    process.stdout.write(JSON.stringify({
      fullSweep: scan.shouldAdvanceSweepMarker({ dryRun: false, singleKeyword: null }),
      keywordRun: scan.shouldAdvanceSweepMarker({ dryRun: false, singleKeyword: 'Softwareentwickler' }),
      dryRun: scan.shouldAdvanceSweepMarker({ dryRun: true, singleKeyword: null }),
    }));
  `;
  const out3 = JSON.parse(execFileSync(NODE, [
    '--input-type=module', '-e', keywordRunSource,
    pathToFileURL(join(ROOT, 'scan-interamt.mjs')).href,
  ], { env, encoding: 'utf8' }));

  if (out3.fullSweep === true && out3.keywordRun === false && out3.dryRun === false) {
    pass(`shouldAdvanceSweepMarker() advances only on a full, non-dry-run sweep (--keyword: ${out3.keywordRun}, --dry-run: ${out3.dryRun})`);
  } else {
    fail(`expected {fullSweep:true, keywordRun:false, dryRun:false}, got ${JSON.stringify(out3)}`);
  }
} catch (err) {
  fail(`scan-interamt-sweep-date-floor probe crashed: ${err.message}`);
}
