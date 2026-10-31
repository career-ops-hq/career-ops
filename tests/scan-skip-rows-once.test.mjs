// tests/scan-skip-rows-once.test.mjs — a scanner's skip buckets are recorded
// once per posting per status, not once per run.
//
// #2695 made scan.mjs record its title, location and posting-age skips through
// unrecordedOffers, "so the file grows with new postings rather than with
// scans", and modes/scan.md states the contract: "Each posting gets one such
// row per status, not one per scan." scan-interamt.mjs and scan-dayforce.mjs
// were missed. Both refill every skip bucket on every run and appended it
// straight, and both write skipped_dup for each posting already seen. A board
// of 200 stable postings scanned weekly gained about 200 rows a week, and
// stats.mjs counts rows, so "jobs recorded" and the per-portal counts grew
// with the number of runs.
//
// The writer runs in a child process because discovered suites share one
// process (and one module cache) with the rest of test-all, so scan.mjs may
// already be imported with its real SCAN_HISTORY_PATH baked in.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { trackedFiles } from '../lib/mjs-files.mjs';

console.log('\nscan-history skip rows — once per posting per status, not once per run');

const root = mkdtempSync(join(tmpdir(), 'career-ops-skip-once-'));
const historyPath = join(root, 'data', 'scan-history.tsv');

// The offers and the status come from a JSON file read at run time, never
// spliced into the evaluated source.
const writerSource = `
  const { readFileSync } = await import('node:fs');
  const [scanUrl, jobFile] = process.argv.slice(-2);
  const { appendUnrecordedToScanHistory } = await import(scanUrl);
  const { offers, status } = JSON.parse(readFileSync(jobFile, 'utf8'));
  process.stdout.write(String(await appendUnrecordedToScanHistory(offers, '2026-10-25', status)));
`;

let jobSeq = 0;
function record(urls, status) {
  const jobFile = join(root, `job-${++jobSeq}.json`);
  const offers = urls.map((u) => ({ url: u, source: 'interamt', title: 'Referent', company: 'Stadt', location: 'Berlin' }));
  writeFileSync(jobFile, JSON.stringify({ offers, status }));
  const out = execFileSync(NODE, ['--input-type=module', '-e', writerSource, pathToFileURL(join(ROOT, 'scan.mjs')).href, jobFile], {
    // An exported path override outranks CAREER_OPS_ROOT, and the history one
    // would take these fixture rows into the developer's real file. So it is
    // pinned to the fixture's, and every other override scan.mjs honours is
    // blanked, which reads as unset.
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_SCAN_HISTORY: historyPath,
      CAREER_OPS_PIPELINE: '',
      CAREER_OPS_PORTALS: '',
      CAREER_OPS_PROFILE: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_AGGREGATOR_DOMAINS: '',
    },
    encoding: 'utf8',
  });
  return Number(out.trim());
}

/** Rows per `url status` pair. */
function rowCounts() {
  const counts = new Map();
  for (const line of readFileSync(historyPath, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const key = `${cols[0]} ${cols[5]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

try {
  const A = 'https://interamt.de/koop/app/stelle?id=1001';
  const B = 'https://interamt.de/koop/app/stelle?id=1002';
  const C = 'https://interamt.de/koop/app/stelle?id=1003';

  // Run 1, then run 2 with the same bucket: the second run adds nothing.
  const first = record([A, B], 'skipped_title');
  const second = record([A, B], 'skipped_title');
  const afterTwo = rowCounts();
  if (first === 2 && second === 0 && afterTwo.get(`${A} skipped_title`) === 1 && afterTwo.get(`${B} skipped_title`) === 1) {
    pass('a skip bucket handed back on the next run writes no second row');
  } else {
    fail(`second run re-recorded the bucket: wrote ${first} then ${second}; rows ${JSON.stringify([...afterTwo])}`);
  }

  // A posting new to the bucket is still recorded, alongside the known one.
  const third = record([A, C], 'skipped_title');
  const afterThree = rowCounts();
  if (third === 1 && afterThree.get(`${A} skipped_title`) === 1 && afterThree.get(`${C} skipped_title`) === 1) {
    pass('a posting new to the bucket is recorded, the known one is not');
  } else {
    fail(`mixed bucket wrong: wrote ${third}; rows ${JSON.stringify([...afterThree])}`);
  }

  // Each status is its own record: A skipped under another status gets a row.
  const fourth = record([A, A], 'skipped_dup');
  const afterFour = rowCounts();
  if (fourth === 1 && afterFour.get(`${A} skipped_dup`) === 1 && afterFour.get(`${A} skipped_title`) === 1) {
    pass('another status gets its own row, once, even when the bucket repeats a URL');
  } else {
    fail(`per-status record wrong: wrote ${fourth}; rows ${JSON.stringify([...afterFour])}`);
  }

  if (record([], 'skipped_title') === 0) {
    pass('an empty bucket writes nothing');
  } else {
    fail('an empty bucket wrote rows');
  }
} catch (err) {
  fail(`appendUnrecordedToScanHistory run crashed: ${err.message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

// Census: a scanner that appends a skip status straight re-records the bucket
// every run. Writers allowed to do that, with the reason each records a
// posting once by other means; an entry that stops matching fails below.
const DIRECT_SKIP_WRITERS = new Map([
  ['scan.mjs', 'routes its title/location/age/no-apply buckets through unrecordedOffers itself (#2695); its expired, cooldown and guard rows go to URLs the seen set then skips'],
  ['check-liveness.mjs', 'planExpiredHistoryRows writes each URL once, under the lock'],
]);
const SKIP_APPEND = /appendToScanHistory\([^\n]*['"`](?:skipped_[a-z_]+|cooldown:)/;
// Code lines only: a doc comment naming the call (liveness-core.mjs has one)
// is not a write.
const codeOnly = (src) => src.split('\n').filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n');
const direct = new Set();
for (const abs of trackedFiles(ROOT, (rel) => rel.endsWith('.mjs') && !rel.startsWith('tests/') && rel !== 'test-all.mjs')) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  if (SKIP_APPEND.test(codeOnly(readFileSync(abs, 'utf8')))) direct.add(rel);
}
const unexplained = [...direct].filter((f) => !DIRECT_SKIP_WRITERS.has(f));
const stale = [...DIRECT_SKIP_WRITERS.keys()].filter((f) => !direct.has(f));
if (direct.has('check-liveness.mjs') && unexplained.length === 0 && stale.length === 0) {
  pass('only scan.mjs and check-liveness.mjs append a skip status straight; every other scanner goes through appendUnrecordedToScanHistory');
} else {
  fail(`skip-status writers: unexplained ${JSON.stringify(unexplained)} (use appendUnrecordedToScanHistory), stale allowlist entries ${JSON.stringify(stale)}`);
}

// The two scanners this fixed record every skip bucket through the helper.
for (const file of ['scan-interamt.mjs', 'scan-dayforce.mjs']) {
  const src = codeOnly(readFileSync(join(ROOT, file), 'utf8'));
  const throughHelper = (src.match(/appendUnrecordedToScanHistory\(/g) || []).length;
  if (throughHelper >= 4 && !SKIP_APPEND.test(src)) {
    pass(`${file} records its ${throughHelper} skip buckets through appendUnrecordedToScanHistory`);
  } else {
    fail(`${file} appends a skip bucket straight, or records too few through the helper (${throughHelper})`);
  }
}
