#!/usr/bin/env node

/**
 * scan-seek.mjs — SEEK keyword scanner over the SEO path form (NZ and AU).
 *
 * Fetches https://{nz|au}.seek.com/<keyword>-jobs[/in-<Location>] and reads the
 * job records out of the page's inlined `window.SEEK_REDUX_DATA` (id, title,
 * advertiser, location, salary label, listing date, teaser, work types, and
 * SEEK's Remote/Hybrid/On-site label as `workArrangement` for workplace_policy).
 *
 * Unlike `providers/jobstreet.mjs` (which queries `/api/jobsearch/v5/search`
 * for known companies in `companies:`), this scanner discovers roles by
 * keyword across domestic employers and recruiters that have no public ATS
 * board. It never fetches a `/job/<id>` detail page: the posting URL is built
 * for the pipeline, not requested during the scan.
 *
 * Both sites are served from the same SEO path form and inline the same Redux
 * dump, so the only per-site differences are the fetch host, the posting host
 * (AU posts under `www.seek.com.au`, which 403s a plain fetch), the location
 * slug map and the location record shape `seekLocation()` already reads.
 *
 * PAGINATION & FRESHNESS (#6694). Paginates `?page=N` (from page 2 onward) up
 * to `max_pages` per search (default 5, cap 50, or `--pages N` on the CLI),
 * stopping early when a page yields no new postings. `--daterange N` (or
 * `daterange: N` on an entry) appends `daterange=N` so results are scoped to
 * the last N days of ads. (Until #6691, query strings were omitted to stay
 * inside `nz.seek.com/robots.txt`'s `*?` disallow; rule 6 no longer treats
 * `robots.txt` as a gate.)
 *
 * Config (portals.yml): `seek_site` (`nz`, the default, or `au`) and
 * `seek_searches`, a list of `{ keyword, location?, daterange?, max_pages? }`.
 * `title_filter`, `location_filter` and `data/blacklist.md` apply as in scan.mjs.
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

const KNOWN_FLAGS = ['--help', '-h', '--daterange', '--pages', '--max-pages', '--delay-ms', '--dry-run'];
const VALUE_FLAGS = ['--daterange', '--pages', '--max-pages', '--delay-ms'];
const USAGE = `Usage:
  node scan-seek.mjs                  # scan seek_searches from portals.yml
  node scan-seek.mjs --daterange 7    # restrict to the last 7 days (?daterange=7)
  node scan-seek.mjs --pages 3        # fetch up to 3 pages per search (?page=N)
  node scan-seek.mjs --dry-run        # print matches, write nothing

Reads seek_site and seek_searches from portals.yml:
  seek_site: au                       # optional; nz (default) or au
  seek_searches:
    - keyword: "data analyst"
      location: "Adelaide"            # optional; omit for the whole country
      daterange: 7                    # optional; last N days
      max_pages: 5                    # optional; default 5 (cap 50)

Fetches the SEO path ({nz|au}.seek.com/<keyword>-jobs[/in-<Location>]) and
reads the inlined window.SEEK_REDUX_DATA results, paging ?page=N until a page
yields no new postings or max_pages is reached.

Flags:
  --daterange N     append daterange=N (last N days of ads)
  --pages N         max pages per search (default 5, cap 50; alias --max-pages)
  --delay-ms N      pause between requests (default 2000)
  --dry-run         do not touch pipeline, scan history or scan-runs
  --help, -h        show this help and exit`;

export const DEFAULT_MAX_PAGES = 5;
export const MAX_PAGES_CAP = 50;

function coercePositiveInt(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1) return v;
  if (typeof v === 'string' && /^[1-9]\d*$/.test(v.trim())) {
    const n = Number(v.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  return v;
}

function parsePositiveInt(val, name) {
  const n = coercePositiveInt(val);
  if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 1) return n;
  throw new Error(`Invalid ${name} ${JSON.stringify(val)}; must be a positive integer`);
}

export function loadSearches(portals) {
  const list = Array.isArray(portals?.seek_searches) ? portals.seek_searches : [];
  return list
    .map((s) => (typeof s === 'string' ? { keyword: s } : s))
    .filter((s) => s && typeof s.keyword === 'string' && s.keyword.trim())
    .map((s) => {
      const entry = { keyword: s.keyword.trim(), location: (s.location || '').trim() };
      const maxPages = s.max_pages ?? s.pages;
      if (maxPages !== undefined && maxPages !== null && maxPages !== '') {
        entry.max_pages = coercePositiveInt(maxPages);
      }
      if (s.daterange !== undefined && s.daterange !== null && s.daterange !== '') {
        entry.daterange = coercePositiveInt(s.daterange);
      }
      return entry;
    });
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

// State-wide forms are `in-<State-Name>` or the bare `in-<ABBR>`; `in-All-<State>`
// returns zero results on SEEK, so it is never used for a state. City forms
// take the short `<City>-<STATE>` slug, not `in-All-<City>-<STATE>`.
const AU_LOCATION_SLUGS = {
  adelaide: 'in-Adelaide-SA',
  'adelaide-sa': 'in-Adelaide-SA',
  'south-australia': 'in-South-Australia',
  sa: 'in-SA',
  sydney: 'in-Sydney-NSW',
  'sydney-nsw': 'in-Sydney-NSW',
  'new-south-wales': 'in-New-South-Wales',
  nsw: 'in-NSW',
  melbourne: 'in-Melbourne-VIC',
  'melbourne-vic': 'in-Melbourne-VIC',
  victoria: 'in-Victoria',
  vic: 'in-VIC',
  brisbane: 'in-Brisbane-QLD',
  'brisbane-qld': 'in-Brisbane-QLD',
  queensland: 'in-Queensland',
  qld: 'in-QLD',
  perth: 'in-Perth-WA',
  'perth-wa': 'in-Perth-WA',
  'western-australia': 'in-Western-Australia',
  wa: 'in-WA',
  canberra: 'in-Canberra-ACT',
  'canberra-act': 'in-Canberra-ACT',
  'australian-capital-territory': 'in-Australian-Capital-Territory',
  act: 'in-ACT',
  hobart: 'in-Hobart-TAS',
  'hobart-tas': 'in-Hobart-TAS',
  tasmania: 'in-Tasmania',
  tas: 'in-TAS',
  darwin: 'in-Darwin-NT',
  'darwin-nt': 'in-Darwin-NT',
  'northern-territory': 'in-Northern-Territory',
  nt: 'in-NT',
  newcastle: 'in-Newcastle-NSW',
  'newcastle-nsw': 'in-Newcastle-NSW',
  'gold-coast': 'in-Gold-Coast-QLD',
  'gold-coast-qld': 'in-Gold-Coast-QLD',
  wollongong: 'in-Wollongong-NSW',
  'wollongong-nsw': 'in-Wollongong-NSW',
  geelong: 'in-Geelong-VIC',
  'geelong-vic': 'in-Geelong-VIC',
  remote: 'in-Remote',
};

/**
 * Per-site hosts, location map and country aliases that mean "no location".
 * `base` is the fetch host; `postingBase` is the host written into the offer's
 * URL. They differ on AU: `www.seek.com.au` answers 403 to a plain fetch but is
 * the host jobstreet writes, so scan-history/tracker URLs only dedup with it.
 */
export const SEEK_SITES = {
  nz: {
    base: 'https://nz.seek.com',
    postingBase: 'https://nz.seek.com',
    locations: NZ_LOCATION_SLUGS,
    countrySlugs: ['new-zealand', 'nz'],
    label: 'NZ',
  },
  au: {
    base: 'https://au.seek.com',
    postingBase: 'https://www.seek.com.au',
    locations: AU_LOCATION_SLUGS,
    countrySlugs: ['australia', 'au', 'all-australia'],
    label: 'AU',
  },
};

/** Resolve `seek_site` from portals.yml (default `nz`) to a site descriptor. */
export function resolveSeekSite(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return SEEK_SITES.nz;
  // Validate the shape before stripping anything: a suffix-stripping lookup
  // would coerce `seek.com`, `au.seek.com.au` or `evil.com/au` into a valid key.
  const host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  const key = host.endsWith('.seek.com') ? host.slice(0, -'.seek.com'.length) : '';
  // Object.hasOwn, not a bare lookup: `constructor` and `__proto__` would
  // otherwise resolve to Object.prototype members instead of throwing.
  const resolved = Object.hasOwn(SEEK_SITES, raw) ? raw : key;
  if (!Object.hasOwn(SEEK_SITES, resolved)) {
    throw new Error(`Unknown seek_site ${JSON.stringify(value)}; use "nz" or "au"`);
  }
  return SEEK_SITES[resolved];
}

/**
 * Resolve a configured location ("Wellington", "Adelaide", or "in-All-Wellington")
 * to SEEK's canonical `in-...` path segment for that site, or throw if an
 * unmapped plain location is passed instead of guessing a broken URL.
 */
export function formatSeekLocation(location, site = SEEK_SITES.nz) {
  const raw = String(location ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!raw) return '';
  if (/^in-[A-Za-z0-9-]+$/.test(raw)) {
    return raw.replace(/^in-(all-)?/i, (_, all) => (all ? 'in-All-' : 'in-'));
  }
  const key = slugify(raw);
  if (site.countrySlugs.includes(key)) return '';
  if (site.locations[key]) return site.locations[key];
  throw new Error(`Unknown SEEK ${site.label} location ${JSON.stringify(location)}; use a known ${site.label} region/city or a canonical "in-..." SEEK path slug`);
}

/**
 * SEO path URL for one search. `daterange` (positive integer days), `page`
 * (1-based; omitted on page 1) and `site` (a SEEK_SITES entry; defaults to NZ)
 * are read from the options object. A bare number or null in that position is
 * still read as `daterange`, which keeps the original call shape working.
 */
export function buildSeekUrl({ keyword, location, daterange: entryDaterange }, optsOrDaterange = null, pageArg = 1) {
  const kw = slugify(keyword);
  if (!kw) throw new Error(`Empty keyword: ${JSON.stringify(keyword)}`);
  const isOpts = optsOrDaterange !== null && typeof optsOrDaterange === 'object';
  const site = (isOpts && optsOrDaterange.site) || SEEK_SITES.nz;
  const loc = formatSeekLocation(location, site);
  const daterange = isOpts ? (optsOrDaterange.daterange ?? entryDaterange ?? null) : (optsOrDaterange ?? entryDaterange ?? null);
  const page = isOpts ? (optsOrDaterange.page ?? 1) : (pageArg ?? 1);

  const params = new URLSearchParams();
  if (daterange !== null && daterange !== undefined && daterange !== '') {
    const days = parsePositiveInt(daterange, 'daterange');
    params.set('daterange', String(days));
  }
  if (page !== null && page !== undefined && page !== 1) {
    const p = parsePositiveInt(page, 'page');
    if (p > 1) params.set('page', String(p));
  }
  const base = `${site.base}/${kw}-jobs${loc ? `/${loc}` : ''}`;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
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
const SEEK_COUNTRIES = { NZ: 'New Zealand', AU: 'Australia' };

/**
 * Location text for one SEEK job. Older payloads carry a flat `location` /
 * `locationLabel` string; current ones carry `locations: [{ label,
 * countryCode }]` instead, which read as an empty location and failed every
 * location_filter. The country is appended from `countryCode` so a
 * workplace_policy can see which country a remote role is in.
 */
export function seekLocation(job) {
  const flat = job.location ?? job.locationLabel;
  if (typeof flat === 'string' && flat.trim()) return decodeHtml(flat);
  return toArray(job.locations)
    .map((l) => {
      const label = decodeHtml(l?.label ?? '');
      const country = SEEK_COUNTRIES[String(l?.countryCode ?? '').toUpperCase()];
      if (!label) return country ?? '';
      return country && !label.toLowerCase().includes(country.toLowerCase()) ? `${label}, ${country}` : label;
    })
    .filter(Boolean)
    .join(' / ');
}

/**
 * SEEK's own work arrangement label ("Remote", "Hybrid", "On-site"), as the
 * `workArrangement` field the workplace_policy reads. Omitted when absent.
 */
export function seekWorkArrangement(job) {
  const wa = job.workArrangements;
  const labels = toArray(wa?.data).map((d) => decodeHtml(d?.label?.text ?? '')).filter(Boolean);
  const text = labels.length ? labels.join(', ') : decodeHtml(typeof wa?.displayText === 'string' ? wa.displayText : '');
  return text ? { workArrangement: text } : {};
}

export function parseSeekPage(html, site = SEEK_SITES.nz) {
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
      url: `${site.postingBase}/job/${id}`, // recorded, never fetched during scan
      title: decodeHtml(j.title),
      company: decodeHtml(j.advertiser?.description ?? j.companyName ?? ''),
      location: seekLocation(j),
      salary: decodeHtml(j.salaryLabel ?? ''),
      teaser: decodeHtml(j.teaser ?? ''),
      workTypes: toArray(j.workTypes).map(String),
      ...seekWorkArrangement(j),
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
      source: `seek-${site.label.toLowerCase()}`,
    });
  }
  return offers;
}

/**
 * Page through one SEEK search (`?page=1..maxPages`), stopping early when a
 * page returns no unseen job IDs.
 */
export async function scanSeekSearch(
  search,
  {
    fetchText,
    site = SEEK_SITES.nz,
    daterange = null,
    maxPages = null,
    delayMs = 0,
    sleepImpl = sleep,
  } = {},
) {
  const rawMax = maxPages ?? search?.max_pages ?? DEFAULT_MAX_PAGES;
  const pages = parsePositiveInt(rawMax, 'max_pages');
  const pageLimit = Math.min(pages, MAX_PAGES_CAP);
  const effectiveDaterange = daterange ?? search?.daterange ?? null;
  const seenIds = new Set();
  const collected = [];
  let lastUrl = search?.keyword ?? '';

  for (let page = 1; page <= pageLimit; page++) {
    try {
      lastUrl = buildSeekUrl(search, { site, daterange: effectiveDaterange, page });
      if (page > 1 && delayMs > 0) await sleepImpl(delayMs);
      const html = await fetchText(lastUrl);
      const offers = parseSeekPage(html, site);
      const fresh = offers.filter((o) => !seenIds.has(o.id));
      if (fresh.length === 0) break;
      for (const o of fresh) {
        seenIds.add(o.id);
        collected.push(o);
      }
    } catch (err) {
      if (err && typeof err === 'object' && !err.seekUrl) err.seekUrl = lastUrl;
      if (page === 1) throw err;
      collected.incomplete = true;
      collected.error = err;
      break;
    }
  }
  return collected;
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
  const daterangeRaw = flagValue(args, '--daterange');
  if (daterangeRaw !== undefined && !/^[1-9]\d*$/.test(daterangeRaw)) {
    console.error('Error: --daterange needs a positive whole number of days');
    process.exit(1);
  }
  const daterange = daterangeRaw !== undefined ? Number(daterangeRaw) : null;

  for (const flag of ['--pages', '--max-pages']) {
    const raw = flagValue(args, flag);
    if (raw !== undefined && !/^[1-9]\d*$/.test(raw)) {
      console.error(`Error: ${flag} needs a positive whole number of pages`);
      process.exit(1);
    }
  }
  const pagesRaw = flagValue(args, '--pages') ?? flagValue(args, '--max-pages');
  const maxPages = pagesRaw !== undefined ? Number(pagesRaw) : null;

  const delayRaw = flagValue(args, '--delay-ms');
  const delayMs = delayRaw !== undefined ? Number(delayRaw) : 2000;
  if (delayRaw !== undefined && (delayRaw.trim() === '' || !Number.isFinite(delayMs) || delayMs < 0)) {
    console.error('Error: --delay-ms needs a non-negative number');
    process.exit(1);
  }

  const portals = loadPortals();
  let site;
  try {
    site = resolveSeekSite(portals.seek_site);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
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
    try {
      const offers = await scanSeekSearch(searches[i], {
        fetchText: (url) => fetchTextWithRetry(ctx, url, { headers: { 'accept-language': 'en' } }),
        site,
        daterange,
        maxPages,
        delayMs,
      });
      found += offers.length;
      for (const offer of offers) {
        if (gate.check(offer)) continue;
        added.push(offer);
        console.log(`  ✅ ${offer.company} — ${offer.title}`);
      }
      if (offers.error) {
        errors++;
        console.warn(`⚠️  ${offers.error.seekUrl || searches[i].keyword}: ${offers.error.message}`);
      }
    } catch (err) {
      errors++;
      console.warn(`⚠️  ${err.seekUrl || searches[i].keyword}: ${err.message}`);
    }
  }

  if (!dryRun) {
    if (added.length > 0) {
      await appendToPipeline(added);
      await appendToScanHistory(added, localToday(), 'added');
    }
    await writeRunLog({ found, counts: gate.counts, newAdded: added.length, queries: searches.length, errors });
  }

  // Literal per site, not a template: the banner title is a contract tests/
  // scan-summary-marker.test.mjs asserts on the source text.
  if (site === SEEK_SITES.au) {
    printScanSummaryHeader('SEEK AU Scan', localToday());
  } else {
    printScanSummaryHeader('SEEK NZ Scan', localToday());
  }
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
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  // process.exitCode, not process.exit(1): a fatal error here comes after the
  // SEEK requests, and on Windows Node 24 aborts when process.exit() runs right
  // after a request (nodejs/node#56645, the crash in #3788), printing a libuv
  // assertion and a crash code instead of this message and exit 1.
  main(args).catch((err) => { console.error('Fatal:', err.message); process.exitCode = 1; });
}
