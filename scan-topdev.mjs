#!/usr/bin/env node
// @ts-check
/**
 * scan-topdev.mjs — TopDev (topdev.vn) scanner via Playwright
 *
 * Why this is a standalone browser scanner and not a `providers/*.mjs` module
 * (providers/ADDING_A_PROVIDER.md, "Browser-based scanners"):
 *
 * Measured live on 2026-11-10:
 *   - A bare Node `fetch()` of the search URL answers `200` with ~741 KB of
 *     HTML and no challenge page, so the board does NOT hard-block a plain
 *     client the way JobsGo/ViecOi do.
 *   - But the search RESULT LIST is not in that HTML. Only ~15 postings appear,
 *     all of them inside the Next.js RSC flight payload (`self.__next_f.push`)
 *     and belonging to "super hot jobs"/recommendation rails, not to the query.
 *     The query results are hydrated client-side after boot.
 *   - No `/api/` path is exposed in the payload to read instead.
 *
 * So the listing cannot be read without executing the page: same shape as
 * scan-interamt.mjs and scan-dayforce.mjs, which is the accepted pattern for a
 * source with no reachable API. `providers/` stays fetch-only.
 *
 * This scanner reads only what a visitor sees: no login, no account, no
 * cookies of a real person, and it never solves or relays a challenge — a
 * challenge page is reported as a named error and the board is skipped.
 *
 * Reads `topdev_searches` from portals.yml:
 *   topdev_searches:
 *     - keyword: "backend"          # required — submitted to TopDev's search
 *       location: "Ho Chi Minh"     # optional — narrows via region_ids
 *       max_pages: 5                # optional — default 5, hard cap 50
 *
 * Usage:
 *   node scan-topdev.mjs
 *   node scan-topdev.mjs --dry-run
 *   node scan-topdev.mjs --keyword "backend"
 *   node scan-topdev.mjs --debug            # save screenshot + HTML to output/
 *   node scan-topdev.mjs --help|-h
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadYaml } from './lib/yaml-document.mjs';
import {
  appendToPipeline,
  appendToScanHistory,
  appendUnrecordedToScanHistory,
  BROWSER_PROCESS_ENV,
  DATA_ROOT as SCAN_DATA_ROOT,
  PORTALS_PATH,
  SCAN_HISTORY_PATH,
} from './scan.mjs';
import { createAdmissionGate } from './lib/admission-gate.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { scanHistoryDataLines } from './lib/scan-history-columns.mjs';
import { browserLaunchOptions } from './lib/browser-launch.mjs';
import { BOT_CHALLENGE_PATTERNS } from './liveness-core.mjs';

// ── Constants ────────────────────────────────────────────────────────

export const ALLOWED_HOST = 'topdev.vn';
const SEARCH_BASE_URL = 'https://topdev.vn/jobs/search';

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 50;

/** Pacing between page loads of the same keyword (see --all note in README). */
const INTER_PAGE_DELAY_MS = 1500;

/**
 * TopDev's own region ids, read off the board's search links.
 * Only these three were ever observed; an unrecognized location is dropped
 * rather than guessed into the URL, so a typo broadens the search instead of
 * silently narrowing it to the wrong city.
 */
export const REGION_IDS = Object.freeze({
  'ho chi minh': '79',
  'hồ chí minh': '79',
  hcm: '79',
  hcmc: '79',
  saigon: '79',
  hanoi: '01',
  'ha noi': '01',
  'hà nội': '01',
  'da nang': '48',
  danang: '48',
  'đà nẵng': '48',
});

// Card markup, confirmed against a live hydrated page on 2026-11-10:
//   <div class="text-card-foreground ...">
//     <img alt="job-image" ...>
//     <span class="w-full">
//       <div ...><div ...>
//         <a href="/detail-jobs/{slug}-{id}?src=...">{title}</a>
//         <span ...>{company}</span>
//       ...
//       <div class="... grid grid-cols-2 ...">
//         <span ...><svg/> <span class="line-clamp-1"> {location}</span></span>
//         <span ...><svg/> <span class="line-clamp-1">{level}</span></span>
//         <span ...><svg/> <span class="line-clamp-1">{age}</span></span>
const CARD_SELECTOR = 'div[class*="text-card-foreground"]';
const CARD_TITLE_LINK_SELECTOR = 'a[href*="/detail-jobs/"]';
const CARD_GRID_SELECTOR = 'div[class*="grid-cols-2"]';

/** Interstitial markup/text that means "blocked", never "empty board". */
export const CHALLENGE_MARKERS = Object.freeze([
  'just a moment',
  'challenge-platform',
  'challenge-form',
  'cf-challenge',
]);

const DATA_ROOT = getCareerOpsRoot();
const SCAN_HISTORY = SCAN_HISTORY_PATH;

// ── Args ─────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--dry-run', '--debug', '--all', '--keyword', '--help', '-h'];
const VALUE_FLAGS = ['--keyword'];

const USAGE = `Usage:
  node scan-topdev.mjs
  node scan-topdev.mjs --dry-run
  node scan-topdev.mjs --all              # skip the date filter (first scan)
  node scan-topdev.mjs --keyword "backend"
  node scan-topdev.mjs --debug            # save screenshot + page HTML to output/
  node scan-topdev.mjs --help|-h          # print this usage block and exit`;

/**
 * Parse CLI arguments. Kept pure and argv-injected so a test can drive it
 * without the module reading `process.argv` at import time.
 *
 * @param {string[]} argv
 * @returns {{dryRun: boolean, debug: boolean, noDateFilter: boolean, singleKeyword: (string|null)}}
 */
export function parseArgs(argv = []) {
  return {
    dryRun: hasFlag(argv, '--dry-run'),
    debug: hasFlag(argv, '--debug'),
    noDateFilter: hasFlag(argv, '--all'),
    singleKeyword: flagValue(argv, '--keyword') ?? null,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────

/**
 * Normalize a location string to a TopDev region id.
 *
 * @param {unknown} location
 * @returns {string|null} Region id, or null when the location is absent or unknown.
 */
export function regionIdFor(location) {
  if (typeof location !== 'string') return null;
  const key = location.trim().toLowerCase();
  if (!key) return null;
  return REGION_IDS[key] ?? null;
}

/**
 * @param {unknown} value
 * @returns {boolean} True for a plain 1-3 digit region id.
 */
export function validateRegionId(value) {
  return typeof value === 'string' && /^\d{1,3}$/.test(value);
}

/**
 * Validate and normalize one `topdev_searches` entry.
 *
 * @param {unknown} raw
 * @param {number} index - Position in the list, for the error message.
 * @returns {{keyword: string, regionId: (string|null), maxPages: number}}
 */
export function normalizeSearchEntry(raw, index = 0) {
  const where = `topdev_searches[${index}]`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: expected a mapping with a \`keyword\``);

  const rawKeyword = /** @type {any} */ (raw).keyword;
  const keyword = typeof rawKeyword === 'string' ? rawKeyword.trim() : '';
  if (!keyword) throw new Error(`${where}: \`keyword\` is required and must be a non-empty string`);

  const rawLocation = /** @type {any} */ (raw).location;
  const regionId = rawLocation === undefined || rawLocation === null
    ? null
    : regionIdFor(rawLocation);
  if (rawLocation !== undefined && rawLocation !== null && regionId === null) {
    throw new Error(
      `${where}: unknown location "${String(rawLocation)}" — known: ` +
      `${Object.keys(REGION_IDS).join(', ')}. Omit \`location\` for a nationwide search.`,
    );
  }

  const rawMax = Number.isInteger(/** @type {any} */ (raw).max_pages) ? /** @type {any} */ (raw).max_pages : DEFAULT_MAX_PAGES;
  const maxPages = Math.min(Math.max(1, rawMax), MAX_PAGES_CAP);

  return { keyword, regionId, maxPages };
}

/**
 * Build the search URL for one page.
 *
 * @param {string} keyword
 * @param {string|null} regionId
 * @param {number} page - 1-based.
 * @returns {string}
 */
export function buildSearchUrl(keyword, regionId, page) {
  // A region id reaches the URL as a query value, so it is shape-checked here
  // rather than trusted: the map above is the only producer today, and this
  // guard is what keeps a future edit to it from putting arbitrary text into a
  // request the scanner then treats as pinned.
  if (regionId !== null && regionId !== undefined && !validateRegionId(regionId)) {
    throw new Error(`topdev: invalid region id "${String(regionId)}" — expected 1-3 digits`);
  }
  const params = new URLSearchParams();
  params.set('keyword', String(keyword));
  params.set('page', String(page));
  if (regionId) params.set('region_ids', regionId);
  const url = `${SEARCH_BASE_URL}?${params.toString()}`;
  assertTopDevUrl(url);
  return url;
}

/**
 * Host-pin a URL to topdev.vn over HTTPS. Applied to every request and to
 * every resolved posting URL, so an off-host anchor or a poisoned parameter
 * cannot turn this scanner into an SSRF hop.
 *
 * @param {string} url
 * @returns {string} The same URL, validated.
 */
export function assertTopDevUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`topdev: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`topdev: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST) {
    throw new Error(`topdev: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  }
  return parsed.toString();
}

/**
 * Resolve a card's href to a canonical posting URL.
 *
 * The board appends tracking parameters (`?src=topdev_home&medium=superhotjobs`)
 * that differ per rail, so they are stripped: two sightings of one posting must
 * collapse to one dedup key. Anything that is not a topdev.vn posting (an ad
 * slot, a partner card reusing the anchor shape) is dropped rather than emitted.
 *
 * @param {unknown} href
 * @returns {string|null}
 */
export function resolvePostingUrl(href) {
  if (typeof href !== 'string' || !href.trim()) return null;
  try {
    const resolved = new URL(href.trim(), `https://${ALLOWED_HOST}`);
    if (resolved.protocol !== 'https:') return null;
    if (resolved.hostname !== ALLOWED_HOST) return null;
    resolved.search = '';
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Parse TopDev's relative publication label ("3 ngày trước", "2 hours ago")
 * into epoch ms.
 *
 * The board publishes no absolute date on a card, so this is the only
 * publication signal available. An unparseable label yields `undefined` rather
 * than a guessed timestamp — a wrong `postedAt` is worse than none, because
 * downstream date filters act on it.
 *
 * @param {unknown} text
 * @param {number} [nowMs]
 * @returns {number|undefined}
 */
export function parseRelativeAge(text, nowMs = Date.now()) {
  if (typeof text !== 'string') return undefined;
  const t = text.trim().toLowerCase();
  if (!t) return undefined;

  if (/^(vừa xong|just now|vừa đăng)$/.test(t)) return nowMs;

  const m = t.match(/^(\d+)\s*(minutes|minute|min|hours|hour|days|day|weeks|week|months|month|phút|giờ|ngày|tuần|tháng)(?:\s|$)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch (m[2]) {
    case 'phút': case 'minute': case 'minutes': case 'min': return nowMs - n * MINUTE_MS;
    case 'giờ': case 'hour': case 'hours': return nowMs - n * HOUR_MS;
    case 'ngày': case 'day': case 'days': return nowMs - n * DAY_MS;
    case 'tuần': case 'week': case 'weeks': return nowMs - n * 7 * DAY_MS;
    case 'tháng': case 'month': case 'months': return nowMs - n * 30 * DAY_MS;
    default: return undefined;
  }
}

/**
 * Turn the raw card objects extracted from the page into Job records.
 *
 * Pure and injected with `nowMs`, so the mapping is unit-testable without a
 * browser. Cards missing a title or resolving off-host are dropped; duplicates
 * (one posting can appear in a recommendation rail and the results list) are
 * collapsed by URL.
 *
 * @param {Array<{title?: string, href?: string, company?: string, location?: string, texts?: string[]}>} cards
 * @param {number} [nowMs]
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function cardsToJobs(cards, nowMs = Date.now()) {
  if (!Array.isArray(cards)) return [];
  /** @type {Map<string, {title: string, url: string, company: string, location: string, postedAt?: number}>} */
  const byUrl = new Map();

  for (const card of cards) {
    if (!card || typeof card !== 'object') continue;
    const title = typeof card.title === 'string' ? card.title.trim() : '';
    const url = resolvePostingUrl(card.href);
    if (!title || !url || byUrl.has(url)) continue;

    const company = typeof card.company === 'string' ? card.company.trim() : '';
    const location = typeof card.location === 'string' ? card.location.replace(/\s+/g, ' ').trim() : '';

    let postedAt;
    if (Array.isArray(card.texts)) {
      for (const text of card.texts) {
        const parsed = parseRelativeAge(text, nowMs);
        if (parsed !== undefined) { postedAt = parsed; break; }
      }
    }

    byUrl.set(url, {
      title,
      url,
      company,
      location,
      ...(postedAt !== undefined ? { postedAt } : {}),
    });
  }

  return [...byUrl.values()];
}

/**
 * Does this page show an anti-bot challenge instead of listings?
 *
 * A challenge is a block, not an empty board, and must be reported as such
 * (ADDING_A_PROVIDER.md §2 rule 3: never solve, relay, or retry a challenge).
 *
 * @param {unknown} haystack - Page title, HTML, or both concatenated.
 * @returns {boolean}
 */
export function detectChallenge(haystack) {
  if (typeof haystack !== 'string' || !haystack) return false;
  const hay = haystack.toLowerCase();
  if (CHALLENGE_MARKERS.some((marker) => hay.includes(marker.toLowerCase()))) return true;
  return BOT_CHALLENGE_PATTERNS.some((re) => re.test(hay));
}

/** Thrown when TopDev puts a challenge in front of its public listings. */
export class TopDevChallengeError extends Error {
  constructor(url) {
    super(`topdev: challenge page served at ${url} — not solved, not retried (see ADDING_A_PROVIDER.md §2 rule 3)`);
    this.name = 'TopDevChallengeError';
  }
}

/** Thrown when the results region never renders, so "empty" is not a verdict. */
export class TopDevRenderError extends Error {
  constructor(url, title) {
    super(
      `topdev: ${url} never rendered its listings (page title: "${title}"). ` +
      'This is either a markup change or a block — rerun with --debug and inspect the dump.',
    );
    this.name = 'TopDevRenderError';
  }
}

// ── Date helpers ─────────────────────────────────────────────────────

/**
 * Most recent first_seen date recorded for the `topdev` source.
 *
 * @returns {Date|null}
 */
function loadLastScanDate() {
  if (!existsSync(SCAN_HISTORY)) return null;
  let latest = null;
  scanHistoryDataLines(readFileSync(SCAN_HISTORY, 'utf-8')).forEach((line) => {
    const parts = line.split('\t');
    if (parts[2] !== 'topdev') return;
    const d = new Date((parts[1] || '') + 'T00:00:00Z');
    if (!isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
  });
  return latest;
}

// ── Browser extraction (not unit-tested — the live smoke test covers it) ──

/**
 * Read the hydrated cards out of the page.
 *
 * @param {import('playwright').Page} page
 */
async function extractCards(page) {
  return page.$$eval(CARD_SELECTOR, (nodes, selectors) => {
    return nodes.map((card) => {
      const anchor = card.querySelector(selectors.titleLink);
      if (!anchor) return null;

      const companyEl = anchor.nextElementSibling;
      const grid = card.querySelector(selectors.grid);
      // Direct cell spans only: nested spans inside a cell repeat its text, so
      // querySelectorAll('span') yields every cell twice. Falls back to the
      // descendants if the grid wraps its cells differently.
      const direct = grid ? [...grid.querySelectorAll(':scope > span')] : [];
      const cells = direct.length ? direct : (grid ? [...grid.querySelectorAll('span')] : []);
      const texts = cells.map((s) => (s.textContent || '').trim()).filter(Boolean);
      const locationCell = cells[0]?.querySelector('span') ?? cells[0];

      return {
        title: (anchor.textContent || '').trim(),
        href: anchor.getAttribute('href') || '',
        company: (companyEl?.textContent || '').trim(),
        location: (locationCell?.textContent || '').trim(),
        texts,
      };
    }).filter(Boolean);
  }, { titleLink: CARD_TITLE_LINK_SELECTOR, grid: CARD_GRID_SELECTOR });
}

/**
 * Load one search page and return the postings on it.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{debug?: boolean, nowMs?: number}} [options]
 * @returns {Promise<{jobs: Array<{title: string, url: string, company: string, location: string, postedAt?: number}>, cardCount: number}>}
 */
export async function scanSearchPage(page, url, options = {}) {
  assertTopDevUrl(url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The listing is hydrated after boot: wait for a card, not for load state.
  const rendered = await page
    .waitForSelector(CARD_SELECTOR, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (options.debug) await dumpDebug(page);

  if (!rendered) {
    // Only now is "blocked vs broken" the question worth asking. Testing the
    // challenge markers on a page that DID render cards would risk reading an
    // i18n string inside a healthy JS bundle ("just a moment") as a block.
    const title = await page.title().catch(() => '');
    const html = await page.content().catch(() => '');
    if (detectChallenge(`${title}\n${html}`)) throw new TopDevChallengeError(url);
    throw new TopDevRenderError(url, title);
  }

  // Cards can arrive in rails before the results grid settles.
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);

  const cards = await extractCards(page);
  return { jobs: cardsToJobs(cards, options.nowMs ?? Date.now()), cardCount: cards.length };
}

/**
 * Dump a screenshot and the page HTML to the data root's output/ directory,
 * which is User Layer and therefore follows the data root rather than the CWD.
 *
 * @param {import('playwright').Page} page
 */
async function dumpDebug(page) {
  const debugDir = join(DATA_ROOT, 'output');
  mkdirSync(debugDir, { recursive: true });
  const png = join(debugDir, 'debug-topdev.png');
  const htmlPath = join(debugDir, 'debug-topdev.html');
  await page.screenshot({ path: png, fullPage: true }).catch(() => null);
  writeFileSync(htmlPath, await page.content().catch(() => ''));
  console.log(`  [debug] screenshot → ${png}`);
  console.log(`  [debug] html       → ${htmlPath}`);
  console.log(`  [debug] url:`, page.url());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Main ─────────────────────────────────────────────────────────────

/**
 * @param {{argv?: string[]}} [options]
 */
export async function main({ argv = [] } = {}) {
  const { dryRun, debug, noDateFilter, singleKeyword } = parseArgs(argv);

  mkdirSync(join(DATA_ROOT, 'data'), { recursive: true });

  let config = {};
  if (existsSync(PORTALS_PATH)) {
    config = loadYaml(readFileSync(PORTALS_PATH, 'utf-8')) || {};
  }

  const rawSearches = Array.isArray(config.topdev_searches) ? config.topdev_searches : [];
  if (rawSearches.length === 0) {
    console.error(
      'No `topdev_searches` configured in portals.yml.\n' +
      'Add at least one entry, for example:\n\n' +
      'topdev_searches:\n' +
      '  - keyword: "backend"\n' +
      '    location: "Ho Chi Minh"\n',
    );
    return 1;
  }

  /** @type {Array<{keyword: string, regionId: (string|null), maxPages: number}>} */
  const searches = rawSearches.map((raw, i) => normalizeSearchEntry(raw, i));

  const gate = createAdmissionGate({ config });
  const date = localToday();
  const lastScanDate = noDateFilter ? null : loadLastScanDate();
  if (noDateFilter) console.log('  --all: date filter disabled — fetching every rendered page');
  else if (lastScanDate) console.log(`  Last TopDev scan: ${lastScanDate.toISOString().slice(0, 10)} — skipping older postings`);

  const newOffers = [];
  const titleSkipped = [];
  const locationSkipped = [];
  const dateSkipped = [];
  const dupeSkipped = [];
  const errors = [];
  // Searches overlap, so one posting comes back under several keywords. Its
  // first sighting already got a verdict and a scan-history row; a repeat must
  // not pin the URL with a skipped_dup row on top of a skip meant to be revisited.
  const handledThisRun = new Set();

  let totalFound = 0;

  const browser = await chromium.launch(browserLaunchOptions(
    { headless: true },
    { projectRoot: SCAN_DATA_ROOT, processEnv: BROWSER_PROCESS_ENV },
  ));
  const context = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await context.newPage();

  try {
    for (const search of searches) {
      const keywords = singleKeyword ? [singleKeyword] : [search.keyword];

      for (const keyword of keywords) {
        const seenUrls = new Set();

        for (let pageNum = 1; pageNum <= search.maxPages; pageNum++) {
          if (pageNum > 1) await sleep(INTER_PAGE_DELAY_MS);
          const url = buildSearchUrl(keyword, search.regionId, pageNum);
          process.stdout.write(`  "${keyword}" page ${pageNum}... `);

          let pageJobs;
          try {
            pageJobs = await scanSearchPage(page, url, { debug: debug && pageNum === 1 });
          } catch (err) {
            // A challenge or a never-rendered page is a board-level failure:
            // report it and move on rather than reporting an empty market.
            process.stdout.write(`ERROR\n`);
            errors.push({ keyword, page: pageNum, error: /** @type {Error} */ (err).message });
            break;
          }

          totalFound += pageJobs.jobs.length;
          process.stdout.write(`${pageJobs.jobs.length} found\n`);

          let added = 0;
          for (const job of pageJobs.jobs) {
            if (seenUrls.has(job.url)) continue;
            seenUrls.add(job.url);
            added++;

            const canonical = {
              url: job.url,
              company: job.company || 'TopDev',
              title: job.title,
              location: job.location,
              source: 'topdev',
              ...(job.postedAt !== undefined ? { postedAt: job.postedAt } : {}),
            };

            if (handledThisRun.has(canonical.url)) continue;
            handledThisRun.add(canonical.url);

            const reason = gate.check(canonical);
            if (reason === 'seen') { dupeSkipped.push(canonical); continue; }
            if (reason === 'blacklisted') continue;
            if (reason === 'title') { titleSkipped.push(canonical); continue; }
            if (reason === 'location') { locationSkipped.push(canonical); continue; }
            if (lastScanDate && job.postedAt !== undefined && new Date(job.postedAt) < lastScanDate) {
              dateSkipped.push(canonical);
              continue;
            }
            newOffers.push(canonical);
          }

          // A page that adds nothing new means the board stopped paginating.
          if (added === 0) break;
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!dryRun) {
    if (newOffers.length > 0) await appendToPipeline(newOffers);
    if (newOffers.length > 0) await appendToScanHistory(newOffers, date, 'added');
    await appendUnrecordedToScanHistory(titleSkipped, date, 'skipped_title');
    await appendUnrecordedToScanHistory(locationSkipped, date, 'skipped_location');
    await appendUnrecordedToScanHistory(dateSkipped, date, 'skipped_date');
    await appendUnrecordedToScanHistory(dupeSkipped, date, 'skipped_dup');
  }

  printScanSummaryHeader('TopDev Scan', date);
  console.log(`Searches:           ${searches.length}`);
  console.log(`Total found:        ${totalFound}`);
  console.log(`Filtered by title:  ${titleSkipped.length}`);
  console.log(`Filtered location:  ${locationSkipped.length}`);
  console.log(`Blacklisted:        ${gate.counts.blacklisted}`);
  console.log(`Filtered by date:   ${dateSkipped.length}`);
  console.log(`Duplicates:         ${dupeSkipped.length}`);
  console.log(`New offers:         ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ "${e.keyword}" page ${e.page}: ${e.error}`);
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    console.log(dryRun ? '\n(dry run — not saved)' : '\nSaved to data/pipeline.md');
  }

  console.log('\n→ Run /career-ops pipeline to evaluate new offers.');
  // Errors are reported in the summary above, not through the exit code —
  // same convention as scan-interamt.mjs and scan-dayforce.mjs, so a scheduled
  // caller does not treat one challenged keyword as a crashed scan.
  return 0;
}

// Guarded so importing this module (a test, or anything else) never drives a
// live scan and appends to the user's pipeline — the rule every sibling
// scanner follows (scan-interamt.mjs:411, scan-dayforce.mjs).
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  validateFlags(argv, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  main({ argv })
    .then((code) => { if (code) process.exit(code); })
    .catch((err) => {
      console.error('Fatal:', err.message);
      process.exit(1);
    });
}
