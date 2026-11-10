// A workplace policy already says which places a person can take. The scan
// still collapsed one company and title to whichever posting arrived first,
// so a later allowed city never reached the pipeline, and a city already
// stored as added kept blocking it on the next run.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — keep a takeable city for one company and role');

const EMPTY_TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const POLICY = `location_filter:
  allow: ["Harbor Bay", "Remote", "United States"]
  always_allow: ["Harbor Bay"]
  workplace_policy:
    onsite_locations: ["Harbor Bay"]
    remote_countries: ["United States"]
    remote_regions: ["United States"]
`;

const HISTORY_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
const SEEDED_UNTAKEABLE = `${HISTORY_HEADER}
https://boards.example.com/fixture/pebbleford\t2026-11-01\tlocal-parser\tAutomation Analyst\tLumenfield\tadded\tPebbleford, TX
`;

function pipelineUrls(dir) {
  const file = join(dir, 'data', 'pipeline.md');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^- \[[ x]\]\s+https?:\/\//.test(line))
    .map((line) => line.match(/https?:\/\/[^\s|]+/)?.[0])
    .filter(Boolean);
}

function runScan(dir, portalsPath) {
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portalsPath };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CAREER_OPS_') && key !== 'CAREER_OPS_ROOT' && key !== 'CAREER_OPS_PORTALS') delete env[key];
  }
  execFileSync(NODE, [join(ROOT, 'scan.mjs'), '--quiet'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sandbox({ portalsBlock, history = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-takeable-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), EMPTY_TRACKER);
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
  if (history) writeFileSync(join(dir, 'data', 'scan-history.tsv'), history);
  const portals = join(dir, 'portals.yml');
  writeFileSync(portals, `${portalsBlock}title_filter:
  positive:
    - "Automation Analyst"
tracked_companies:
  - name: Lumenfield
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/takeable-city-board.mjs
`);
  return { dir, portals };
}

function urlsOf(label, dir) {
  try {
    return pipelineUrls(dir);
  } catch (err) {
    fail(`${label} could not be read: ${err.message}`);
    return null;
  }
}

function sameHref(url, raw) {
  try {
    return new URL(url).href === new URL(raw).href;
  } catch {
    return false;
  }
}

function expectTakeable(label, urls) {
  if (!urls) return;
  const remote = urls.some((url) => sameHref(url, 'https://boards.example.com/fixture/remote'));
  const harbor = urls.filter((url) => url.includes('/harbor'));
  const pebbleford = urls.some((url) => sameHref(url, 'https://boards.example.com/fixture/pebbleford'));
  if (remote && harbor.length === 1 && !pebbleford) {
    pass(label);
  } else {
    fail(`${label}: got ${JSON.stringify(urls)}`);
  }
}

{
  const { dir, portals } = sandbox({ portalsBlock: POLICY });
  try {
    runScan(dir, portals);
    const afterFirst = urlsOf('policy scan', dir);
    expectTakeable('an earlier untakeable city loses to the later allowed cities', afterFirst);
    runScan(dir, portals);
    const afterSecond = urlsOf('second policy scan', dir);
    expectTakeable('a later scan keeps the allowed cities and does not put the untakeable city back', afterSecond);
  } catch (err) {
    fail(`policy scan failed: ${err.stderr || err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { dir, portals } = sandbox({ portalsBlock: POLICY, history: SEEDED_UNTAKEABLE });
  try {
    runScan(dir, portals);
    expectTakeable('a stored untakeable city does not block a later allowed city', urlsOf('stored city scan', dir));
  } catch (err) {
    fail(`stored-city scan failed: ${err.stderr || err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { dir, portals } = sandbox({ portalsBlock: 'scan_history:\n  dedup_include_location: false\n' + POLICY });
  try {
    runScan(dir, portals);
    const urls = urlsOf('explicit-off scan', dir);
    if (urls && urls.length === 1 && urls[0] === 'https://boards.example.com/fixture/remote') {
      pass('an explicit dedup_include_location false still collapses allowed cities');
    } else if (urls) {
      fail(`explicit false did not collapse: ${JSON.stringify(urls)}`);
    }
  } catch (err) {
    fail(`explicit-off scan failed: ${err.stderr || err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { dir, portals } = sandbox({ portalsBlock: '' });
  try {
    runScan(dir, portals);
    const urls = urlsOf('no-policy scan', dir);
    if (urls && urls.length === 1 && urls[0] === 'https://boards.example.com/fixture/pebbleford') {
      pass('without a workplace policy, one company and title still collapses to one row');
    } else if (urls) {
      fail(`no-policy collapse changed: ${JSON.stringify(urls)}`);
    }
  } catch (err) {
    fail(`no-policy scan failed: ${err.stderr || err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
