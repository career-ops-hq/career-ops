#!/usr/bin/env node

/**
 * scan-seek.mjs — SEEK NZ keyword scanner over the SEO path form.
 *
 * Fetches https://nz.seek.com/<keyword>-jobs[/in-All-<Location>] and reads the
 * job records out of the page's inlined `window.SEEK_REDUX_DATA` (id, title,
 * advertiser, location, salary label, listing date, teaser, work types).
 *
 * WHY THIS SHAPE. nz.seek.com/robots.txt disallows, for every agent,
 * any /job/ path, `*?`, `/graphql` and `/api/jobsearch/`. The JSON API that
 * `providers/jobstreet.mjs` calls (`/api/jobsearch/v5/search` for known
 * companies in `companies:`) is therefore off limits for robots-strict scanning.
 * The SEO path form carries no disallowed segment, so this scanner fetches only
 * that, and discovers roles by keyword across NZ-domestic employers and
 * recruiters with no public ATS board. It never fetches a `/job/<id>` page:
 * the URL is built for the pipeline, not requested.
 *
 * NO PAGINATION. Paging needs a query string, which `*?` disallows. Depth
 * comes from more, narrower queries (one per seek_searches entry); Seek's
 * totalCount is fuzzy relevance matching, so deeper pages would be less
 * relevant anyway.
 *
 * relevance and can be dominated by older ads. There is deliberately no date
 * window flag: it would need `?daterange=N`, a query string, and `*?` is
 * disallowed, so the scanner only ever requests query-free paths.
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
import { makeHttpCtx, fetchTextWithRetry } from './providers/_http.mjs';
import {
  sleep, slugify, decodeHtml,
  createLocalGate, formatLocalSkips, writeRunLog,
} from './scan-local-lib.mjs';

const KNOWN_FLAGS = ['--help', '-h', '--delay-ms', '--dry-run'];
const USAGE = `Usage:
  node scan-seek.mjs                  # one request per seek_searches entry
  node scan-seek.mjs --dry-run        # print matches, write nothing

Reads seek_searches from portals.yml:
  seek_searches:
    - keyword: "data analyst"
      location: "Wellington"          # optional; omit for all of NZ

Fetches only the SEO path (nz.seek.com/<keyword>-jobs[/in-All-<Location>]) and
reads the inlined search results. No query string, no pagination; add narrower
searches for depth.

Flags:
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

const NZ_LOCATION_SLUGS = {
  auckland: 'in-All-Auckland',
  wellington: 'in-All-Wellington',
  canterbury: 'in-All-Canterbury',
  christchurch: 'in-All-Christchurch-Canterbury',
  waikato: 'in-All-Waikato',
  hamilton: 'in-All-Hamilton-Waikato',
  'bay-of-plenty': 'in-All-Bay-of-Plenty',
  tauranga: 'in-All-Tauranga-Bay-of-Plenty',
  rotorua: 'in-All-Rotorua-Bay-of-Plenty',
  otago: 'in-All-Otago',
  dunedin: 'in-All-Dunedin-Otago',
  queenstown: 'in-Queenstown-Otago',
  manawatu: 'in-All-Manawatu',
  'palmerston-north': 'in-All-Palmerston-North-Manawatu',
  'hawkes-bay': 'in-All-Hawkes-Bay',
  napier: 'in-All-Napier-Hawkes-Bay',
  taranaki: 'in-All-Taranaki',
  'new-plymouth': 'in-All-New-Plymouth-Taranaki',
  northland: 'in-All-Northland',
  whangarei: 'in-All-Whangarei-Northland',
  southland: 'in-All-Southland',
  invercargill: 'in-All-Invercargill-Southland',
  nelson: 'in-All-Nelson-Tasman',
  tasman: 'in-All-Tasman',
  marlborough: 'in-All-Marlborough',
  gisborne: 'in-All-Gisborne',
  'west-coast': 'in-All-West-Coast',
  masterton: 'in-Masterton-Wellington',
};

/**
 * Resolve a configured location ("Wellington", "Masterton", or "in-All-Wellington")
 * to SEEK's canonical `in-...` path segment, or throw if an unmapped plain
 * location is passed instead of guessing a broken `in-All-...` URL.
 */
export function formatSeekLocation(location) {
  const raw = String(location ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!raw) return '';
  if (/^in-[A-Za-z0-9-]+$/.test(raw)) {
    return raw.replace(/^in-(all-)?/i, (_, all) => (all ? 'in-All-' : 'in-'));
  }
  const key = slugify(raw);
  if (key === 'new-zealand' || key === 'nz') return '';
  if (NZ_LOCATION_SLUGS[key]) return NZ_LOCATION_SLUGS[key];
  throw new Error(`Unknown SEEK NZ location ${JSON.stringify(location)}; use a known NZ region/city or a canonical "in-..." SEEK path slug`);
}

/** SEO path URL for one search: query-free, as nz.seek.com/robots.txt requires (`*?`). */
export function buildSeekUrl({ keyword, location }) {
  const kw = slugify(keyword);
  if (!kw) throw new Error(`Empty keyword: ${JSON.stringify(keyword)}`);
  const loc = formatSeekLocation(location);
  return `${BASE}/${kw}-jobs${loc ? `/${loc}` : ''}`;
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
  if (!raw) throw new Error('SEEK_REDUX_DATA not found — page may be blocked or layout changed');
  let data;
  try {
    // Redux dumps serialize JS undefined as a bare token.
    data = JSON.parse(raw.replace(/:\s*undefined\b/g, ':null'));
  } catch (err) {
    throw new Error(`SEEK_REDUX_DATA is not valid JSON: ${err.message}`);
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

  const ctx = makeHttpCtx();
  const gate = createLocalGate({ config: portals });
  const added = [];
  let found = 0;
  let errors = 0;

  for (let i = 0; i < searches.length; i++) {
    if (i > 0) await sleep(delayMs);
    let url = searches[i].keyword;
    try {
      url = buildSeekUrl(searches[i]);
      const offers = parseSeekPage(await fetchTextWithRetry(ctx, url, { headers: { 'accept-language': 'en' } }));
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
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: ['--delay-ms'], requireOperand: true });
  main(args).catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}
