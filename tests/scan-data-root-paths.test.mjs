// tests/scan-data-root-paths.test.mjs — scan.mjs blacklist + scan-runs defaults
// must resolve under DATA_ROOT, not cwd.
//
// SCAN_HISTORY_PATH / PIPELINE_PATH already join(DATA_ROOT, …). BLACKLIST_PATH
// and SCAN_RUNS_PATH were bare `data/…` strings, so a run with cwd ≠ DATA_ROOT
// (the documented CAREER_OPS_DATA_DIR case) wrote scan-runs where stats.mjs
// does not read them, and missed data/blacklist.md in the data root.
//
// Spawns a child: DATA_ROOT is a module-level constant, so an in-process
// import would see this process's env, not the lane under test. Callers that
// pass an explicit filePath keep that override (loadBlacklist(filePath = …)).
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — blacklist and scan-runs resolve under DATA_ROOT, not cwd');

const scanUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-scan-dataroot-'));
const otherCwd = mkdtempSync(join(tmpdir(), 'career-ops-scan-cwd-'));
const overrideDir = mkdtempSync(join(tmpdir(), 'career-ops-scan-override-'));

mkdirSync(join(dataRoot, 'data'), { recursive: true });
mkdirSync(join(otherCwd, 'data'), { recursive: true });
writeFileSync(
  join(dataRoot, 'data', 'blacklist.md'),
  [
    '| Company | Since | Scope | Reason |',
    '|---------|-------|-------|--------|',
    '| Data Root Co | 2026-01-01 | all | fixture |',
    '',
  ].join('\n'),
  'utf-8',
);
const overridePath = join(overrideDir, 'blacklist.md');
writeFileSync(
  overridePath,
  [
    '| Company | Since | Scope | Reason |',
    '|---------|-------|-------|--------|',
    '| Override Co | 2026-01-01 | all | explicit |',
    '',
  ].join('\n'),
  'utf-8',
);

const SCANNER_PATH_VARS = [
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_ROOT',
  'CAREER_OPS_DATA_DIR',
];

try {
  const script = `
    const mod = await import(${scanUrl});
    const fromRoot = [...mod.loadBlacklist().keys()];
    const fromOverride = [...mod.loadBlacklist(${JSON.stringify(overridePath)}).keys()];
    mod.appendScanRunSummary({
      timestamp: '2026-01-01T00:00:00.000Z',
      status: 'completed',
      companies: 1, boards: 1, found: 0,
      filteredTitle: 0, filteredTier: 0, filteredLocation: 0, filteredPostingAge: 0,
      filteredSalary: 0, filteredContent: 0, filteredCooldown: 0,
      dupes: 0, newAdded: 0, errors: 0,
      filteredBlacklist: 0, filteredVisa: 0, filteredPostedDate: 0,
      filteredCountryEligibility: 0,
    });
    console.log(JSON.stringify({ fromRoot, fromOverride }));
  `;

  const childEnv = { ...process.env };
  for (const name of SCANNER_PATH_VARS) delete childEnv[name];
  childEnv.CAREER_OPS_DATA_DIR = dataRoot;

  const res = spawnSync(NODE, ['--input-type=module', '-e', script], {
    cwd: otherCwd,
    env: childEnv,
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (res.error || res.status !== 0) {
    fail(`scan.mjs DATA_ROOT child failed: ${res.error?.message || res.stderr}`);
  } else {
    pass('scan.mjs loads with cwd ≠ CAREER_OPS_DATA_DIR');
  }

  let payload = { fromRoot: [], fromOverride: [] };
  try {
    payload = JSON.parse((res.stdout || '').trim().split('\n').at(-1));
  } catch {
    fail(`scan.mjs DATA_ROOT child did not print JSON (${JSON.stringify(res.stdout)})`);
  }

  if (payload.fromRoot.length === 1 && payload.fromRoot[0] === 'datarootco') {
    pass('loadBlacklist() default reads DATA_ROOT/data/blacklist.md, not cwd');
  } else {
    fail(`loadBlacklist() default missed DATA_ROOT blacklist; keys=${JSON.stringify(payload.fromRoot)}`);
  }

  if (payload.fromOverride.length === 1 && payload.fromOverride[0] === 'overrideco') {
    pass('loadBlacklist(filePath) still honors an explicit override');
  } else {
    fail(`loadBlacklist(filePath) override broken; keys=${JSON.stringify(payload.fromOverride)}`);
  }

  const rootRuns = join(dataRoot, 'data', 'scan-runs.tsv');
  const cwdRuns = join(otherCwd, 'data', 'scan-runs.tsv');
  if (existsSync(rootRuns) && readFileSync(rootRuns, 'utf-8').includes('2026-01-01T00:00:00.000Z')) {
    pass('appendScanRunSummary() default writes DATA_ROOT/data/scan-runs.tsv');
  } else {
    fail(`expected ${rootRuns} to contain the fixture row`);
  }
  if (!existsSync(cwdRuns)) {
    pass('appendScanRunSummary() default does not write cwd/data/scan-runs.tsv');
  } else {
    fail(`scan-runs leaked to cwd (${cwdRuns}) — DATA_ROOT split-brain regression`);
  }
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(otherCwd, { recursive: true, force: true });
  rmSync(overrideDir, { recursive: true, force: true });
}
