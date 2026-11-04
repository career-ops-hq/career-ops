#!/usr/bin/env node

/**
 * scan-seek.mjs — SEEK NZ keyword scanner over the SEO path form.
 *
 * Fetches https://nz.seek.com/<keyword>-jobs[/<location>] and reads the job
 * records out of the page's inlined `window.SEEK_REDUX_DATA` (id, title,
 * advertiser, location, salary label, listing date, teaser, work types).
 *
 * WHY THIS SHAPE. nz.seek.com/robots.txt disallows, for every agent,
 * any /job/ path, `*?`, `/graphql` and `/api/jobsearch/`. The JSON API the
 * jobstreet provider calls is therefore off limits here. The SEO path form
 * carries no disallowed segment, so this scanner fetches only that. It never
 * fetches a `/job/<id>` page: the URL is built for the pipeline, not requested.
 * To read a JD for a Seek-only role, use scan-linkedin.mjs's jobPosting
 * endpoint when LinkedIn lists the same role.
 *
 * NO PAGINATION. Paging needs a query string, which `*?` disallows. Depth
 * comes from more, narrower queries (one per seek_searches entry); Seek's
 * totalCount is fuzzy relevance matching, so deeper pages would be less
 * relevant anyway.
 *
 * FRESHNESS TRADE-OFF (opt-in). Without a date window, page 1 is ordered by
 * relevance and can be dominated by older ads. `--daterange N` appends
 * `?daterange=N` so page 1 holds only the last N days of ads. That is a query
 * string, and `*?` is disallowed, so the flag is OFF by default: the default
 * run is robots-compliant and less fresh; passing the flag is the user's
 * explicit choice to trade compliance for freshness.
 *
 * Config (portals.yml): `seek_searches`, a list of `{ keyword, location? }`.
 * title_filter, location_filter and data/blacklist.md apply as in scan.mjs.
 */

try {
  const { config } = await import('dotenv');
  config();
} catch (e) {}

import { readFileSync, existsSync } from 'fs';
import { loadYaml } from './lib/yaml-document.mjs';
import { appendToPipeline, appendToScanHistory, PORTALS_PATH } from './scan.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { validateFlags, flagValue } from './lib/cli-flags.mjs';
import {
  politeFetch, sleep, slugify, decodeHtml,
  createLocalGate, formatLocalSkips, writeRunLog,
} from './scan-local-lib.mjs';

const KNOWN_FLAGS = ['--help', '-h', '--daterange', '--delay-ms', '--dry-run'];
const USAGE = `Usage:
  node scan-seek.mjs                  # one request per seek_searches entry
  node scan-seek.mjs --daterange 7    # opt in: ?daterange=7 (see below)
  node scan-seek.mjs --dry-run        # print matches, write nothing

Reads seek_searches from portals.yml:
  seek_searches:
    - keyword: "data analyst"
      location: "Wellington"          # optional; omit for all of NZ

Fetches only the SEO path (nz.seek.com/<keyword>-jobs/<location>) and reads the
inlined search results. No pagination; add narrower searches for depth.

Flags:
  --daterange N     append ?daterange=N so page 1 holds the last N days of ads.
                    A query string is disallowed by nz.seek.com/robots.txt
                    (\`*?\`), so this is off by default and is your choice.
  --delay-ms N      pause between requests (default 2000)
  --dry-run         do not touch pipeline, scan history or scan-runs
  --help, -h        show this help and exit`;

const BASE = 'https://nz.seek.com';

export function loadSearches(portals) {
  const list = Array.isArray(portals?.seek_searches) ? portals.seek_searches : [];
  return list
    .map((s) => (typeof s === 'string' ? { keyword: s } : s))
    .filter((s) => s && typeof s.keyword === 'string' && s.keyword.trim())
    .map((s) => ({ keyword: s.keyword.trim(), location: (s.location || '').trim() }));
}

/** SEO path URL for one search. `daterange` (days) is the opt-in query string. */
export function buildSeekUrl({ keyword, location }, daterange = null) {
  const kw = slugify(keyword);
  if (!kw) throw new Error(`Empty keyword: ${JSON.stringify(keyword)}`);
  const loc = slugify(location);
  const url = `${BASE}/${kw}-jobs${loc ? `/${loc}` : ''}`;
  return daterange ? `${url}?daterange=${Number(daterange)}` : url;
}

/** Text of the JSON object literal assigned to window.SEEK_REDUX_DATA, or null. */
export function extractReduxJson(html) {
  const marker = html.indexOf('window.SEEK_REDUX_DATA');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

function* walkJobs(node) {
  if (Array.isArray(node)) {
    for (const x of node) yield* walkJobs(x);
  } else if (node && typeof node === 'object') {
    if (node.id !== undefined && typeof node.title === 'string' && node.advertiser) yield node;
    else for (const v of Object.values(node)) yield* walkJobs(v);
  }
}

function toArray(v) {
  return Array.isArray(v) ? v : v ? [v] : [];
}

/**
 * Job records of one results page, normalized to scanner offers. The records
 * are located by shape (id + title + advertiser) rather than by a fixed path
 * into the Redux tree, so a rearranged tree does not silently return nothing.
 */
export function parseSeekPage(html) {
  const raw = extractReduxJson(html);
  if (!raw) return [];
  let data;
  try {
    // Redux dumps serialize JS undefined as a bare token.
    data = JSON.parse(raw.replace(/:\s*undefined\b/g, ':null'));
  } catch {
    return [];
  }
  const seen = new Set();
  const offers = [];
  for (const j of walkJobs(data)) {
    const id = String(j.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const date = typeof j.listingDate === 'string' ? j.listingDate.slice(0, 10) : '';
    offers.push({
      id,
      url: `${BASE}/job/${id}`, // recorded, never fetched (robots: */job/)
      title: decodeHtml(j.title),
      company: decodeHtml(j.advertiser?.description ?? j.companyName ?? ''),
      location: decodeHtml(j.location ?? j.locationLabel ?? ''),
      salary: decodeHtml(j.salaryLabel ?? ''),
      teaser: decodeHtml(j.teaser ?? ''),
      workTypes: toArray(j.workTypes).map(String),
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
      source: 'seek-nz',
    });
  }
  return offers;
}

function loadPortals() {
  if (!existsSync(PORTALS_PATH)) return {};
  try {
    return loadYaml(readFileSync(PORTALS_PATH, 'utf-8')) || {};
  } catch (err) {
    console.error(`Error: failed to parse ${PORTALS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

async function main(args) {
  const dryRun = args.includes('--dry-run');
  const daterange = flagValue(args, '--daterange');
  if (daterange !== undefined && !/^[1-9]\d*$/.test(daterange)) {
    console.error('Error: --daterange needs a positive whole number of days');
    process.exit(1);
  }
  const delayMs = Number(flagValue(args, '--delay-ms') ?? 2000);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    console.error('Error: --delay-ms needs a non-negative number');
    process.exit(1);
  }

  const portals = loadPortals();
  const searches = loadSearches(portals);
  if (searches.length === 0) {
    console.error('No seek_searches in portals.yml. Add entries like { keyword: "data analyst", location: "Wellington" }.');
    process.exit(1);
  }
  if (daterange) console.warn('⚠️  --daterange adds a query string, which nz.seek.com/robots.txt disallows (`*?`).');

  const gate = createLocalGate({ config: portals });
  const added = [];
  let found = 0;
  let errors = 0;

  for (let i = 0; i < searches.length; i++) {
    if (i > 0) await sleep(delayMs);
    const url = buildSeekUrl(searches[i], daterange);
    try {
      const offers = parseSeekPage(await politeFetch(url));
      found += offers.length;
      for (const offer of offers) {
        if (gate.check(offer)) continue;
        added.push(offer);
        console.log(`  ✅ ${offer.company} — ${offer.title}`);
      }
    } catch (err) {
      errors++;
      console.warn(`⚠️  ${url}: ${err.message}`);
    }
  }

  if (!dryRun) {
    if (added.length > 0) {
      await appendToPipeline(added);
      await appendToScanHistory(added, localToday(), 'added');
    }
    await writeRunLog({ found, counts: gate.counts, newAdded: added.length, queries: searches.length, errors });
  }

  printScanSummaryHeader('SEEK NZ Scan', localToday());
  console.log(`Queries:            ${searches.length}`);
  console.log(`Postings fetched:   ${found}`);
  console.log(`New offers:         ${added.length}${dryRun ? ' (dry run, nothing written)' : ''}`);
  const skipped = formatLocalSkips(gate.counts);
  if (skipped) console.log(`Skipped:            ${skipped}`);
  if (errors) console.log(`Errors:             ${errors} of ${searches.length} queries`);
  if (errors === searches.length) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: ['--daterange', '--delay-ms'], requireOperand: true });
  main(args).catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}
