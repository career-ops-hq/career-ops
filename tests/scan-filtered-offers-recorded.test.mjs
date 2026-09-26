// tests/scan-filtered-offers-recorded.test.mjs — what `location_filter` and
// `max_posting_age_days` remove has to leave a trace in scan-history.tsv.
//
// Eleven filters can reject a job inside the scan loop, and exactly one of them
// - the cooldown - wrote a scan-history row; everything the verify and guard
// stages reject is recorded too (`skipped_expired`,
// `skipped_no_apply_control`, `skipped_invalid_url`, `skipped_blocked_host`).
// These two wrote nothing, so the only evidence they ran was a counter printed
// once and never stored. A filter that is slightly too tight is then
// indistinguishable from a portal that had nothing to offer, in the run's own
// output and in every later analysis over the history file.
//
// The rows are deliberately WEIGHTLESS for dedup, which is the half that is
// easy to get wrong. Every other skipped status describes the posting - a dead
// URL stays dead - so pinning it spares a later scan the work. These two
// describe the user's config, and `location_filter` / `max_posting_age_days`
// are thresholds they edit: a row written under the old threshold must not
// suppress the same posting under the new one. Recording a drop in order to
// make it permanent would be worse than not recording it.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { collectSeenUrls, collectSeenCompanyRoles } from '../scan.mjs';

console.log('\nscan.mjs — location- and age-filtered offers are recorded in scan-history.tsv');

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const PORTALS = `title_filter:
  positive:
    - "Strategic Finance"
location_filter:
  block:
    - "India"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/location-split-board.mjs
`;

// Cleared before each spawn so an ambient override cannot redirect the scan at
// the suite runner's own data (the reasoning is spelled out in
// tests/scan-output-paths.test.mjs).
const SCANNER_PATH_VARS = [
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_ROOT',
  'CAREER_OPS_DATA_DIR',
];

function makeLane() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-filtered-record-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  const portals = join(dir, 'portals.yml');
  writeFileSync(portals, PORTALS);
  return { dir, portals };
}

function runScan(dir, portals, args = []) {
  const childEnv = { ...process.env };
  for (const name of SCANNER_PATH_VARS) delete childEnv[name];
  return execFileSync(NODE, [join(ROOT, 'scan.mjs'), ...args], {
    cwd: dir,
    env: { ...childEnv, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** scan-history rows as `{url, status}`, header skipped. */
function historyRows(dir) {
  const file = join(dir, 'data', 'scan-history.tsv');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [url, , , title, , status = 'added'] = line.split('\t');
      return { url, title, status };
    });
}

function pipelineUrls(markdown) {
  return new Set(
    markdown
      .split('\n')
      .map((line) => line.match(/^\s*- \[[ x]\]\s+(https?:\/\/[^\s|]+)/)?.[1])
      .filter(Boolean),
  );
}

const IN_RANGE = 'https://boards.example.com/fixture/2001';
const BLOCKED = 'https://boards.example.com/fixture/2002';

// 1. A real scan over a board with one blocked posting.
{
  const { dir, portals } = makeLane();
  try {
    runScan(dir, portals);
    const rows = historyRows(dir);
    const blocked = rows.find((r) => r.url === BLOCKED);
    const kept = rows.find((r) => r.url === IN_RANGE);

    if (blocked && blocked.status === 'skipped_location') {
      pass('a location-filtered posting is recorded as skipped_location');
    } else {
      fail(`blocked posting recorded as ${blocked ? blocked.status : 'NOTHING — the drop left no trace'}`);
    }

    if (kept && kept.status === 'added') {
      pass('a posting the filter passes is still recorded as added');
    } else {
      fail(`in-range posting recorded as ${kept ? kept.status : 'nothing'}, want added`);
    }

    // Recording is not admitting: the posting must stay out of the inbox.
    const pipeline = existsSync(join(dir, 'data', 'pipeline.md'))
      ? readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8')
      : '';
    const urls = pipelineUrls(pipeline);
    if (!urls.has(BLOCKED) && urls.has(IN_RANGE)) {
      pass('the recorded posting never reaches pipeline.md — what is filtered is unchanged');
    } else {
      fail(`pipeline.md leaked the blocked posting (blocked present: ${urls.has(BLOCKED)}, in-range present: ${urls.has(IN_RANGE)})`);
    }
  } catch (err) {
    fail(`scan over the location fixture failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. --dry-run writes nothing, the same as every other history write.
{
  const { dir, portals } = makeLane();
  try {
    runScan(dir, portals, ['--dry-run']);
    if (historyRows(dir).length === 0) {
      pass('--dry-run records no filtered offers');
    } else {
      fail(`--dry-run wrote ${historyRows(dir).length} scan-history row(s)`);
    }
  } catch (err) {
    fail(`dry-run scan failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. The rows carry no dedup weight. A threshold the user widens has to hand
//    the posting back; a posting-level rejection still stays pinned.
{
  const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
  const LOC = 'https://boards.example.com/fixture/3001';
  const AGE = 'https://boards.example.com/fixture/3002';
  const DEAD = 'https://boards.example.com/fixture/3003';
  const scanHistoryText = [
    HEADER,
    `${LOC}\t2026-01-01\tlocal-parser\tAnalyst\tFixture\tskipped_location\tBengaluru, India`,
    `${AGE}\t2026-01-01\tlocal-parser\tEngineer\tFixture\tskipped_age\tBerlin, Germany`,
    `${DEAD}\t2026-01-01\tlocal-parser\tManager\tFixture\tskipped_expired\tBerlin, Germany`,
    '',
  ].join('\n');

  const { seen, recheckEligible } = collectSeenUrls({ scanHistoryText });

  if (!seen.has(LOC) && !seen.has(AGE)) {
    pass('skipped_location and skipped_age pin nothing — a widened threshold hands the posting back');
  } else {
    fail(`config-rejected rows pinned their URLs (location: ${seen.has(LOC)}, age: ${seen.has(AGE)})`);
  }

  if (seen.has(DEAD)) {
    pass('skipped_expired still pins — a posting-level rejection is unchanged');
  } else {
    fail('skipped_expired stopped pinning, which re-verifies dead URLs on every scan');
  }

  // They were never queued, so calling them "eligible again" would overstate
  // what the recheck window released.
  if (recheckEligible === 0) {
    pass('config-rejected rows are not counted as recheck-eligible either');
  } else {
    fail(`recheckEligible is ${recheckEligible}, want 0`);
  }

  // The company+role key seeds from `added` rows alone, so a dropped role must
  // not bury a sibling posting of the same title.
  const roles = collectSeenCompanyRoles({ scanHistoryText });
  if (roles.size === 0) {
    pass('no company+role key is seeded from a config-rejected row');
  } else {
    fail(`config-rejected rows seeded ${roles.size} company+role key(s): ${[...roles].join(', ')}`);
  }
}
