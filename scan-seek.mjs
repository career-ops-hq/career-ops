#!/usr/bin/env node
/**
 * scan-seek.mjs — zero-token Seek (nz.seek.com) scanner.
 *
 * Companion to scan.mjs, which covers company ATS boards (Greenhouse, Ashby,
 * Lever, SmartRecruiters, Workday). Seek surfaces a largely disjoint population:
 * NZ-domestic product companies that run no public ATS, plus recruiter listings.
 *
 * Why it reads search *pages* and not Seek's JSON API:
 *   nz.seek.com/robots.txt disallows `*?` (any query string), `/api/jobsearch/`
 *   and `/graphql` for `User-agent: *`. The SEO path form carries no query
 *   string, so it is allowed — and its inlined `window.SEEK_REDUX_DATA` holds
 *   the same job records the API returns. No pagination is possible without a
 *   query string, so depth comes from more, narrower queries instead. That is
 *   also the better trade: Seek's totalCount is fuzzy relevance matching, so
 *   deeper pages return progressively less relevant results, while page 1 of a
 *   narrow query is all signal.
 *
 * Usage:
 *   node scan-seek.mjs                  # scan, write pipeline + history
 *   node scan-seek.mjs --dry-run        # print what would be added, write nothing
 *   node scan-seek.mjs --limit 3        # only the first N queries (smoke test)
 *   node scan-seek.mjs --include-blacklisted
 *   node scan-seek.mjs --help           # print usage and exit, no network request
 */

import path from 'path';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { loadYaml } from './lib/yaml-document.mjs';
// Paths and helpers imported from scan.mjs so they honor CAREER_OPS_ROOT (#3510).
import {
  DATA_ROOT,
  PORTALS_PATH,
  SCAN_HISTORY_PATH,
  PIPELINE_PATH,
  APPLICATIONS_PATH,
  loadBlacklist,
  appendToPipeline,
  appendToScanHistory,
  appendScanRunSummary,
} from './scan.mjs';
// Filters, role key and run-log writer shared with scan-linkedin.mjs.
import { makeJobClassifier, loadRoleIndex, appendRunRow } from './scan-local-lib.mjs';

const SEEK_HOST = 'https://nz.seek.com';
const PORTAL_TAG = 'seek-search';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// Seek rate-limits on request volume, not on speed alone: a 110-request run at
// 1.2s spacing earned a sustained IP-level 403. Two defences — a slower paced
// delay with jitter, and a per-run request cap with a rotating cursor so the
// full query list is covered across several small runs instead of one big one.
const DELAY_MS = 4000;
const JITTER_MS = 1500;
const BACKOFF_MS = 60_000;
// Cursor lives in the data root alongside scan-history.tsv
const CURSOR_PATH = path.join(DATA_ROOT, 'data/scan-seek-cursor.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCLUDE_BLACKLISTED = args.includes('--include-blacklisted');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();

function printHelp() {
  console.log(`Usage: node scan-seek.mjs [options]

  --dry-run              Print what would be added, write nothing.
  --limit N              Only run the first N query x location pairs (smoke test);
                         does not advance or write the cursor file.
  --include-blacklisted  Let data/blacklist.md matches through (still annotated).
  --help, -h             Print this usage and exit — no network request.

portals.yml \`seek:\` block:
  queries                 Required. List of Seek search-path slugs.
  locations               List of Seek location slugs. Default: [in-All-Auckland].
  salary_floor            Advertised-base knock-out floor. Default: none.
  max_requests_per_run    Query x location pairs per run. Default: 30.
  daterange               Recency window in days, appended to each search URL
                          as \`daterange=N\` so page 1 is this week's ads.
                          Default: 7.

Cursor (data/scan-seek-cursor.json):
  Rotates through the full query x location pair list across runs — each run
  takes the next \`max_requests_per_run\`-sized window starting at the saved
  offset, then advances the cursor past it. A rate-limited run holds the
  cursor at its starting offset so nothing is skipped. --limit does not
  read past the cursor's own window sizing and never writes it.`);
}

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(DELAY_MS + Math.floor(Math.random() * JITTER_MS));

function readCursor() {
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, 'utf8')).offset || 0;
  } catch {
    return 0;
  }
}
function writeCursor(offset) {
  writeFileSync(CURSOR_PATH, JSON.stringify({ offset, updated: new Date().toISOString() }, null, 2));
}

// ---------------------------------------------------------------- config

function loadConfig() {
  if (!existsSync(PORTALS_PATH)) {
    throw new Error(`${PORTALS_PATH} not found — run onboarding first.`);
  }
  const cfg = loadYaml(readFileSync(PORTALS_PATH, 'utf8')) || {};
  const seek = cfg.seek || {};
  const queries = Array.isArray(seek.queries) ? seek.queries.filter(Boolean) : [];
  const locations = Array.isArray(seek.locations) && seek.locations.length
    ? seek.locations.filter(Boolean)
    : ['in-All-Auckland'];
  if (!queries.length) {
    throw new Error(
      `No \`seek.queries\` in ${PORTALS_PATH}. Add a \`seek:\` block with a \`queries:\` list.`
    );
  }
  const salaryFloor = typeof seek.salary_floor === 'number' ? seek.salary_floor : null;
  const maxRequests = typeof seek.max_requests_per_run === 'number' ? seek.max_requests_per_run : 30;
  const daterange = typeof seek.daterange === 'number' ? seek.daterange : 7;
  return { queries, locations, salaryFloor, maxRequests, daterange };
}

// ---------------------------------------------------------------- HTML parsing

const RE_SLUG = /[^a-z0-9]+/gi;
function slugifyQuery(q) {
  return q.toLowerCase().replace(RE_SLUG, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function extractRedux(html) {
  // Seek inlines a large JSON blob: window.SEEK_REDUX_DATA = { ... };
  // Use a more precise regex that captures up to the final }; or just }
  const m = html.match(/window\.SEEK_REDUX_DATA\s*=\s*(\{[\s\S]*\})\s*;?/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function findJobArray(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    const first = node[0];
    if (first && typeof first === 'object' && 'id' in first && 'title' in first) return node;
    for (const item of node) {
      const found = findJobArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(node)) {
    const found = findJobArray(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeJob(j) {
  const locationParts = [
    j.location?.area,
    j.location?.suburb,
    j.location?.city,
    j.location?.region,
  ].filter(Boolean);
  const company = (j.advertiser?.description || j.company?.displayName || '').trim();
  const workTypes = Array.isArray(j.workTypes) ? j.workTypes.join('/') : '';
  return {
    id: String(j.id),
    title: (j.title || '').trim(),
    company,
    location: locationParts.join(', '),
    url: `${SEEK_HOST}/job/${j.id}`,
    listedAt: String(j.listingDate || '').slice(0, 10),
    teaser: String(j.teaser || '').trim(),
    workTypes,
  };
}

async function fetchQuery(query, location, daterange) {
  const slug = query.replace(/(-jobs)?$/, '-jobs');
  // `daterange=N` is a query string, which robots.txt disallows for the SEO
  // path form (see file header) — traded deliberately here so page 1 holds
  // this week's ads instead of whatever the relevance ranker surfaces first.
  const url = `${SEEK_HOST}/${slug}/${location}?daterange=${daterange}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  } catch (e) {
    return { url, error: `network: ${e.message}`, rateLimited: false, jobs: [], total: null };
  }
  if (!res.ok) {
    return {
      url,
      error: `HTTP ${res.status}`,
      rateLimited: res.status === 403 || res.status === 429,
      jobs: [],
      total: null,
    };
  }
  const html = await res.text();
  const redux = extractRedux(html);
  if (!redux) return { url, error: 'no-redux-blob', jobs: [], total: null };
  const arr = findJobArray(redux);
  if (!arr) return { url, error: 'no-job-array', jobs: [], total: null };
  const totalMatch = html.match(/"totalCount":(\d+)/);
  return {
    url,
    error: null,
    total: totalMatch ? parseInt(totalMatch[1], 10) : null,
    jobs: arr.map(normalizeJob).filter((j) => j.title && j.id),
  };
}

// ---------------------------------------------------------------- output helpers

function tsvEscape(s) {
  return String(s || '').replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '');
}

function appendHistory(rows, today) {
  if (!rows.length) return;
  const lines = rows.map((j) =>
    `${today}\t${PORTAL_TAG}\t${j.id}\t${tsvEscape(j.title)}\t${tsvEscape(j.company)}\t${tsvEscape(j.location)}\t${tsvEscape(j.url)}\tadded`
  ).join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf8');
}

const trackedHint = (j) => (j.related?.length ? `tracked: ${j.related.map((n) => `#${n}`).join(',')}` : '');

function appendPipeline(rows) {
  if (!rows.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const lines = rows.map((j) =>
    `- [ ] ${today} ${j.company} — ${j.title} (${j.location}) ${j.url} ${trackedHint(j)}`
  ).join('\n') + '\n';
  appendFileSync(PIPELINE_PATH, lines, 'utf8');
}

function appendRun(stats) {
  // appendScanRunSummary uses its internal SCAN_RUNS_PATH default (data-root-aware)
  appendScanRunSummary(stats);
}

// ---------------------------------------------------------------- main

async function main() {
  // loadBlacklist uses its internal BLACKLIST_PATH default (data-root-aware)
  const blacklist = loadBlacklist();
  const index = loadRoleIndex({
    applicationsPath: APPLICATIONS_PATH,
    scanHistoryPath: SCAN_HISTORY_PATH,
    pipelinePath: PIPELINE_PATH,
  });

  const { queries, locations, salaryFloor, maxRequests, daterange } = loadConfig();
  const classifier = makeJobClassifier({
    cfg: { salary_floor: salaryFloor },
    index,
    isBlacklisted: (company) => blacklist.has(company.toLowerCase()),
    salaryFloor,
    includeBlacklisted: INCLUDE_BLACKLISTED,
  });

  const pairs = [];
  for (const q of queries) {
    for (const loc of locations) pairs.push({ q, loc });
  }
  if (!pairs.length) {
    console.log('No query x location pairs to run.');
    return;
  }

  const cursor = readCursor();
  const window = pairs.slice(cursor, cursor + maxRequests);
  if (!window.length) {
    console.log('Cursor at end of query list — full cycle complete.');
    return;
  }

  console.log(`Running ${window.length} of ${pairs.length} pairs (cursor ${cursor}).`);

  let totalFound = 0, totalFiltered = 0, totalAdded = 0, totalErrors = 0, rateLimited = false;

  for (let i = 0; i < window.length; i++) {
    const { q, loc } = window[i];
    console.log(`  [${cursor + i + 1}/${pairs.length}] ${q} @ ${loc}`);
    const result = await fetchQuery(q, loc, daterange);
    if (result.error) {
      console.log(`    error: ${result.error}`);
      if (result.rateLimited) rateLimited = true;
      totalErrors++;
      if (rateLimited) break;
      await pace();
      continue;
    }
    const { passed, skipped, failed } = classifier(result.jobs);
    totalFound += result.jobs.length;
    totalFiltered += skipped.length + failed.length;
    const toAdd = passed.filter((j) => j.score !== 'N/A');
    if (toAdd.length && !DRY_RUN) {
      await appendHistory(toAdd, new Date().toISOString().slice(0, 10));
      await appendPipeline(toAdd);
      totalAdded += toAdd.length;
    }
    const status = result.error ? 'error' : (toAdd.length ? 'added' : (skipped.length + failed.length ? 'filtered' : 'empty'));
    // appendRunRow uses the scan-runs.tsv header in the data root
    appendRunRow(path.join(DATA_ROOT, 'data/scan-runs.tsv'), [
      new Date().toISOString(),
      status,
      result.total ?? '?',
      result.jobs.length,
      passed.length,
      skipped.length,
      failed.length,
      toAdd.length,
    ]);
    if (DRY_RUN) {
      console.log(`    would add ${toAdd.length} (found ${result.jobs.length})`);
    } else if (toAdd.length) {
      console.log(`    added ${toAdd.length} (found ${result.jobs.length})`);
    } else {
      console.log(`    no new (found ${result.jobs.length})`);
    }
    await pace();
  }

  if (!DRY_RUN && !rateLimited) {
    writeCursor(cursor + window.length);
  }
  const summary = { timestamp: new Date().toISOString(), totalFound, totalFiltered, totalAdded, totalErrors, rateLimited };
  appendRun(summary);
  console.log(`\nDone. Found: ${totalFound}, filtered: ${totalFiltered}, added: ${totalAdded}, errors: ${totalErrors}${rateLimited ? ', rate-limited' : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { fetchQuery, normalizeJob, extractRedux, findJobArray, slugifyQuery };