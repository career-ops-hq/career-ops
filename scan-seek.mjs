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
 *   the same job records the API returns. Recency comes from `seek.max_age_days`
 *   applied to each record's `listingDate` in-process, never from a query string.
 *   No pagination is possible without a query string either, so depth comes from
 *   more, narrower queries instead. That is the better trade anyway: Seek's
 *   totalCount is fuzzy relevance matching, so deeper pages return progressively
 *   less relevant results, while page 1 of a narrow query is all signal.
 *
 * Usage:
 *   node scan-seek.mjs                  # scan, write pipeline + history
 *   node scan-seek.mjs --dry-run        # print what would be added, write nothing
 *   node scan-seek.mjs --limit 3        # only the first N queries (smoke test)
 *   node scan-seek.mjs --include-blacklisted
 *   node scan-seek.mjs --help           # print usage and exit, no network request
 */

import path from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { loadYaml } from './lib/yaml-document.mjs';
// Paths and writers imported from scan.mjs so they honor CAREER_OPS_ROOT (#3510)
// and keep the shared file contracts (locking, escaping, column order).
import {
  DATA_ROOT,
  PORTALS_PATH,
  SCAN_HISTORY_PATH,
  PIPELINE_PATH,
  APPLICATIONS_PATH,
  loadBlacklist,
  findBlacklistEntry,
  appendToPipeline,
  appendToScanHistory,
  appendScanRunSummary,
} from './scan.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
// Filters, role key and seen-role index shared with scan-linkedin.mjs.
import { makeJobClassifier, loadRoleIndex } from './scan-local-lib.mjs';

const SEEK_HOST = 'https://nz.seek.com';
const PORTAL_TAG = 'seek-search';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// Seek rate-limits on request volume, not on speed alone: a 110-request run at
// 1.2s spacing earned a sustained IP-level 403. Two defences — a slower paced
// delay with jitter, and a per-run request cap with a rotating cursor so the
// full query list is covered across several small runs instead of one big one.
const DELAY_MS = 4000;
const JITTER_MS = 1500;
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
  max_age_days            Drop listings older than N days, judged on each
                          record's own listingDate. Default: 7. Set 0 to keep
                          every listing the page returns.

  title_filter / location_filter at the top level of portals.yml apply here
  exactly as they do in scan.mjs.

Cursor (data/scan-seek-cursor.json):
  Rotates through the full query x location pair list across runs — each run
  takes the next \`max_requests_per_run\`-sized window starting at the saved
  offset, then advances the cursor past it, wrapping to 0 at the end of the
  list. A rate-limited run holds the cursor at its starting offset so nothing
  is skipped. --limit caps the window and never writes the cursor.`);
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
  // A fresh checkout has no data/ yet; the shared writers create their own
  // parents, so the cursor is the one write that needs it here.
  mkdirSync(path.dirname(CURSOR_PATH), { recursive: true });
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
  return {
    queries,
    locations,
    salaryFloor: typeof seek.salary_floor === 'number' ? seek.salary_floor : null,
    maxRequests: typeof seek.max_requests_per_run === 'number' ? seek.max_requests_per_run : 30,
    maxAgeDays: typeof seek.max_age_days === 'number' ? seek.max_age_days : 7,
    // The user's shared filters, not seek.* — every scanner judges titles with
    // the same compiled matcher so "a keyword" means one thing repo-wide.
    titleFilter: cfg.title_filter || {},
    locationFilter: cfg.location_filter || null,
  };
}

// ---------------------------------------------------------------- HTML parsing

const RE_SLUG = /[^a-z0-9]+/gi;
function slugifyQuery(q) {
  return q.toLowerCase().replace(RE_SLUG, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Slice the balanced JSON object that starts at `open`, honouring JSON strings
 * and backslash escapes, so a `}` inside a job teaser or a later <script> block
 * cannot end the slice early or drag trailing markup into the parse.
 * Returns the slice, or null when the braces never balance.
 */
function sliceBalancedObject(text, open) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function extractRedux(html) {
  // Seek inlines its search state as `window.SEEK_REDUX_DATA = { ... };`.
  // Anchor on the assignment, then brace-balance from the first `{`: a greedy
  // regex would run to the last `}` in the document (later script blocks) and a
  // lazy one would stop at the first `}` inside a teaser string.
  const anchor = html.search(/window\.SEEK_REDUX_DATA\s*=\s*/);
  if (anchor === -1) return null;
  const open = html.indexOf('{', anchor);
  if (open === -1) return null;
  const slice = sliceBalancedObject(html, open);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
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

/**
 * Shape one Seek record for the shared filters and writers. `source`, `postedAt`
 * and `salary` are not decoration: appendToScanHistory reads `source` for its
 * portal column and `postedAt` (epoch ms) for posted_at, and formatPipelineOffer
 * reads `salary` for the compensation column.
 */
function normalizeJob(j) {
  const locationParts = [
    j.location?.area,
    j.location?.suburb,
    j.location?.city,
    j.location?.region,
  ].filter(Boolean);
  const company = (j.advertiser?.description || j.company?.displayName || '').trim();
  const listedAt = String(j.listingDate || '').slice(0, 10);
  const postedMs = Date.parse(j.listingDate || '');
  return {
    id: String(j.id),
    title: (j.title || '').trim(),
    company,
    location: locationParts.join(', '),
    url: `${SEEK_HOST}/job/${j.id}`,
    source: PORTAL_TAG,
    listedAt,
    postedAt: Number.isFinite(postedMs) ? postedMs : 0,
    salary: String(j.salaryLabel || '').trim(),
    teaser: String(j.teaser || '').trim(),
    workTypes: Array.isArray(j.workTypes) ? j.workTypes.join('/') : '',
  };
}

async function fetchQuery(query, location) {
  // SEO path form only: no query string, because robots.txt disallows `*?` for
  // every agent. Recency is filtered in-process from each record's listingDate.
  const slug = query.replace(/(-jobs)?$/, '-jobs');
  const url = `${SEEK_HOST}/${slug}/${location}`;
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

// Listings with no parseable date are kept: absence of a date is not evidence
// of an old one, and a wrong drop silently costs a real job.
function withinAge(jobs, maxAgeDays, now = Date.now()) {
  if (!maxAgeDays) return { kept: jobs, tooOld: 0 };
  const cutoff = now - maxAgeDays * 86_400_000;
  const kept = jobs.filter((j) => !j.postedAt || j.postedAt >= cutoff);
  return { kept, tooOld: jobs.length - kept.length };
}

// ---------------------------------------------------------------- main

async function main() {
  // Both use their internal data-root-aware path defaults.
  const blacklist = loadBlacklist();
  const index = loadRoleIndex({
    applicationsPath: APPLICATIONS_PATH,
    scanHistoryPath: SCAN_HISTORY_PATH,
    pipelinePath: PIPELINE_PATH,
  });

  const {
    queries, locations, salaryFloor, maxRequests, maxAgeDays, titleFilter, locationFilter,
  } = loadConfig();
  const classifier = makeJobClassifier({
    cfg: { title_filter: titleFilter, location_filter: locationFilter },
    index,
    // findBlacklistEntry normalizes the label the same way the table was keyed
    // and honours a `domain` scope row, so SEEK agrees with scan.mjs (#1742).
    isBlacklisted: (company, url) => Boolean(findBlacklistEntry(blacklist, company, url)),
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

  // Wrap, so a full cycle resumes at the start instead of parking forever, and
  // so a shrunk queries list never slices an empty window.
  const cursor = readCursor() % pairs.length;
  const size = Math.min(maxRequests, Number.isFinite(LIMIT) ? LIMIT : maxRequests);
  const window = size >= pairs.length
    ? pairs.slice(cursor).concat(pairs.slice(0, cursor))
    : pairs.slice(cursor, cursor + size);

  console.log(`Running ${window.length} of ${pairs.length} pairs (cursor ${cursor}).`);

  const counters = {
    found: 0, dupes: 0, filteredTitle: 0, filteredLocation: 0,
    filteredSalary: 0, filteredBlacklist: 0, filteredContent: 0,
    newAdded: 0, errors: 0,
  };
  const companiesSeen = new Set();
  let rateLimited = false;

  for (let i = 0; i < window.length; i++) {
    const { q, loc } = window[i];
    console.log(`  [${i + 1}/${window.length}] ${q} @ ${loc}`);
    const result = await fetchQuery(q, loc);
    if (result.error) {
      console.log(`    error: ${result.error}`);
      counters.errors++;
      if (result.rateLimited) { rateLimited = true; break; }
      await pace();
      continue;
    }
    const { kept, tooOld } = withinAge(result.jobs, maxAgeDays);
    counters.found += result.jobs.length;
    counters.filteredContent += tooOld;

    const toAdd = [];
    for (const j of kept) {
      if (j.company) companiesSeen.add(normalizeCompany(j.company));
      const v = classifier(j);
      if (v.verdict === 'keep') toAdd.push({ ...j, related: v.related });
      else if (v.verdict === 'repost') counters.dupes++;
      else if (v.verdict === 'title') counters.filteredTitle++;
      else if (v.verdict === 'location') counters.filteredLocation++;
      else if (v.verdict === 'blacklist') counters.filteredBlacklist++;
      else if (v.verdict === 'salary') counters.filteredSalary++;
      else counters.filteredContent++;
    }

    if (toAdd.length && !DRY_RUN) {
      const today = localToday();
      await appendToScanHistory(toAdd, today);
      await appendToPipeline(toAdd);
      counters.newAdded += toAdd.length;
    }
    const label = DRY_RUN ? 'would add' : 'added';
    console.log(`    ${toAdd.length ? label : 'no new'} ${toAdd.length} (found ${result.jobs.length})`);
    await pace();
  }

  // --limit is a smoke test: it must not consume the rotation it did not run.
  if (!DRY_RUN && !rateLimited && !Number.isFinite(LIMIT)) {
    writeCursor((cursor + window.length) % pairs.length);
  }
  if (!DRY_RUN) {
    appendScanRunSummary({
      timestamp: new Date().toISOString(),
      status: rateLimited ? 'rate-limited' : 'completed',
      companies: companiesSeen.size,
      boards: window.length,
      ...counters,
    });
  }
  console.log(
    `\nDone. found ${counters.found}, added ${counters.newAdded}, dupes ${counters.dupes}, `
    + `title ${counters.filteredTitle}, location ${counters.filteredLocation}, `
    + `salary ${counters.filteredSalary}, blacklist ${counters.filteredBlacklist}, `
    + `stale/content ${counters.filteredContent}, errors ${counters.errors}`
    + `${rateLimited ? ' (rate-limited, cursor held)' : ''}`
  );
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { fetchQuery, normalizeJob, extractRedux, findJobArray, sliceBalancedObject, slugifyQuery };