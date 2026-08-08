// tests/scan-output-paths.test.mjs - scan.mjs's two outputs must be
// env-overridable, the same way its two inputs already are (#2271).
//
// `CAREER_OPS_PORTALS` and `CAREER_OPS_PROFILE` already let a second search lane
// bring its own targeting, but data/pipeline.md and data/scan-history.tsv were
// hardcoded, so every lane landed in one inbox. The quiet half is dedup:
// scan-history.tsv is the dedup source, so a posting surfaced by lane A is
// skipped as a duplicate in lane B and never reaches the user at all - the
// counter increments and no row appears.
//
// End-to-end rather than unit, because the defect is in module-level path
// resolution: importing the module in-process would read this process's env, not
// a lane's. Each check spawns a real scan.mjs over the local-parser fixture
// board, so nothing here touches the network.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs - pipeline and scan-history paths are env-overridable (#2271)');

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const PORTALS = `title_filter:
  positive:
    - "Strategic Finance"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/three-city-board.mjs
`;

/** A scan sandbox: temp cwd, empty tracker, fixture portals. */
function makeLane() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-outpaths-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  const portals = join(dir, 'portals.yml');
  writeFileSync(portals, PORTALS);
  return { dir, portals };
}

const runScan = (dir, env) => execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
  cwd: dir,
  env: { ...process.env, ...env },
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

/** Pending rows in a pipeline file; [] when the file was never created. */
function entries(pipelinePath) {
  if (!existsSync(pipelinePath)) return [];
  return readFileSync(pipelinePath, 'utf-8')
    .split('\n')
    .filter((l) => /^- \[[ x]\]\s+https?:\/\//.test(l));
}

// 1. Defaults unchanged. The override is worthless if adding it moved the
//    single-lane user's files, so pin the untouched behavior first.
{
  const { dir, portals } = makeLane();
  try {
    runScan(dir, { CAREER_OPS_PORTALS: portals });
    const defaultEntries = entries(join(dir, 'data', 'pipeline.md')).length;
    const defaultHistory = existsSync(join(dir, 'data', 'scan-history.tsv'));
    if (defaultEntries > 0 && defaultHistory) {
      pass('with no override, scan still writes data/pipeline.md and data/scan-history.tsv');
    } else {
      fail(`default output paths regressed: ${defaultEntries} pipeline entr(y/ies), history file ${defaultHistory ? 'present' : 'MISSING'}`);
    }
  } catch (err) {
    fail(`default-path scan failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. The override actually redirects, and - the half that matters - the default
//    files stay untouched. Asserting only that the lane file filled up would
//    pass just as happily if scan wrote to BOTH.
{
  const { dir, portals } = makeLane();
  try {
    const lanePipeline = join(dir, 'data', 'pipeline.bridge.md');
    const laneHistory = join(dir, 'data', 'scan-history.bridge.tsv');
    runScan(dir, {
      CAREER_OPS_PORTALS: portals,
      CAREER_OPS_PIPELINE: lanePipeline,
      CAREER_OPS_SCAN_HISTORY: laneHistory,
    });

    const laneEntries = entries(lanePipeline).length;
    const defaultTouched = existsSync(join(dir, 'data', 'pipeline.md'))
      || existsSync(join(dir, 'data', 'scan-history.tsv'));

    if (laneEntries > 0 && existsSync(laneHistory) && !defaultTouched) {
      pass('CAREER_OPS_PIPELINE / CAREER_OPS_SCAN_HISTORY redirect both outputs, leaving the defaults untouched');
    } else {
      fail(`override did not fully redirect: ${laneEntries} lane entr(y/ies), lane history ${existsSync(laneHistory) ? 'present' : 'MISSING'}, default files ${defaultTouched ? 'WRITTEN' : 'untouched'}`);
    }
  } catch (err) {
    fail(`overridden-path scan failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. The consequence the issue calls the quiet one: with a shared history the
//    second lane silently suppresses postings the first lane already saw. Two
//    lanes in ONE checkout, same fixture board - separate histories must let
//    both surface it, and the shared-history control proves the suppression is
//    real rather than assumed.
{
  const { dir, portals } = makeLane();
  try {
    const laneA = { pipeline: join(dir, 'data', 'pipeline.a.md'), history: join(dir, 'data', 'scan-history.a.tsv') };
    const laneB = { pipeline: join(dir, 'data', 'pipeline.b.md'), history: join(dir, 'data', 'scan-history.b.tsv') };

    runScan(dir, { CAREER_OPS_PORTALS: portals, CAREER_OPS_PIPELINE: laneA.pipeline, CAREER_OPS_SCAN_HISTORY: laneA.history });
    runScan(dir, { CAREER_OPS_PORTALS: portals, CAREER_OPS_PIPELINE: laneB.pipeline, CAREER_OPS_SCAN_HISTORY: laneB.history });

    const aCount = entries(laneA.pipeline).length;
    const bCount = entries(laneB.pipeline).length;

    // Control: lane B pointed at lane A's history is the pre-fix behavior.
    const shared = join(dir, 'data', 'pipeline.shared.md');
    runScan(dir, { CAREER_OPS_PORTALS: portals, CAREER_OPS_PIPELINE: shared, CAREER_OPS_SCAN_HISTORY: laneA.history });
    const sharedCount = entries(shared).length;

    if (aCount > 0 && bCount === aCount && sharedCount === 0) {
      pass('separate histories let both lanes surface the same posting; a shared history suppresses it');
    } else {
      fail(`cross-lane dedup behavior unexpected: lane A ${aCount}, lane B ${bCount} (want equal and non-zero), shared-history lane ${sharedCount} (want 0)`);
    }
  } catch (err) {
    fail(`two-lane scan failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 4. An override pointing outside data/ must not fail on its first write. Two
//    different code paths happen to provide this today: scan-history creates its
//    own parent, and the pipeline's parent is created by acquirePipelineLock
//    before the first pipeline write. Neither was written with lane overrides in
//    mind, so pin the behavior rather than trust it to stay incidental - the
//    failure mode if either changes is an ENOENT on a lane's very first scan.
{
  const { dir, portals } = makeLane();
  try {
    const lanePipeline = join(dir, 'lanes', 'bridge', 'pipeline.md');
    const laneHistory = join(dir, 'lanes', 'bridge', 'scan-history.tsv');
    runScan(dir, {
      CAREER_OPS_PORTALS: portals,
      CAREER_OPS_PIPELINE: lanePipeline,
      CAREER_OPS_SCAN_HISTORY: laneHistory,
    });
    if (entries(lanePipeline).length > 0 && existsSync(laneHistory)) {
      pass('an override into a not-yet-existing directory creates it instead of failing');
    } else {
      fail('override into a new directory did not produce both outputs');
    }
  } catch (err) {
    fail(`scan into a new directory failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
