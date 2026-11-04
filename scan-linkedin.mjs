#!/usr/bin/env node

/**
 * scan-linkedin.mjs — LinkedIn public (guest) job-search scanner.
 *
 * Uses the two endpoints LinkedIn's own logged-out job-search page calls:
 *   /jobs-guest/jobs/api/seeMoreJobPostings/search   server-rendered cards
 *                                                    (id, title, company, location, date)
 *   /jobs-guest/jobs/api/jobPosting/{id}             one full JD, same format
 *
 * No session, no cookies, nothing from the user's account. Requests are
 * sequential with a pause between them; 429s are retried after Retry-After.
 * LinkedIn may still throttle or block an address that sends many requests, so
 * keep the number of searches and pages small.
 *
 * This is also the JD source for roles whose only other listing is a
 * robots-disallowed SEEK page: `--jd <id>` prints the JD for a LinkedIn job id
 * without fetching the SEEK page.
 *
 * Config (portals.yml): `linkedin_searches`, a list of
 * `{ keywords, location? }`. title_filter, location_filter and
 * data/blacklist.md apply as in scan.mjs.
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
  politeFetch, sleep, decodeHtml,
  createLocalGate, formatLocalSkips, writeRunLog,
} from './scan-local-lib.mjs';

const KNOWN_FLAGS = ['--help', '-h', '--pages', '--since-days', '--delay-ms', '--jd', '--dry-run'];
const USAGE = `Usage:
  node scan-linkedin.mjs                   # first page of each linkedin_searches entry
  node scan-linkedin.mjs --pages 2         # up to 2 pages (25 cards each) per search
  node scan-linkedin.mjs --since-days 7    # only jobs posted in the last 7 days
  node scan-linkedin.mjs --jd 1234567890   # print one job's JD and exit
  node scan-linkedin.mjs --dry-run         # print matches, write nothing

Reads linkedin_searches from portals.yml:
  linkedin_searches:
    - keywords: "platform engineer"
      location: "Auckland, New Zealand"  # optional

Flags:
  --pages N         pages per search (default 1, max 5)
  --since-days N    posted-within window (default: no window)
  --delay-ms N      pause between requests (default 3000)
  --jd ID           print the full JD for a LinkedIn job id
  --dry-run         do not touch pipeline, scan history or scan-runs
  --help, -h        show this help and exit`;

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api';
const PAGE_SIZE = 25;
const MAX_PAGES = 5;

export function loadSearches(portals) {
  const list = Array.isArray(portals?.linkedin_searches) ? portals.linkedin_searches : [];
  return list
    .map((s) => (typeof s === 'string' ? { keywords: s } : s))
    .filter((s) => s && typeof s.keywords === 'string' && s.keywords.trim())
    .map((s) => ({ keywords: s.keywords.trim(), location: (s.location || '').trim() }));
}

export function buildSearchUrl({ keywords, location }, { page = 0, sinceDays = null } = {}) {
  const p = new URLSearchParams({ keywords, start: String(page * PAGE_SIZE) });
  if (location) p.set('location', location);
  if (sinceDays) p.set('f_TPR', `r${Number(sinceDays) * 86400}`);
  return `${BASE}/seeMoreJobPostings/search?${p}`;
}

export function buildJobPostingUrl(id) {
  if (!/^\d+$/.test(String(id))) throw new Error(`Invalid LinkedIn job id: ${id}`);
  return `${BASE}/jobPosting/${id}`;
}

function cleanJobUrl(href, id) {
  // Cards link to .../jobs/view/<slug>-<id>?refId=...&trackingId=...; keep the stable part.
  try {
    const u = new URL(decodeHtml(href));
    return `https://www.linkedin.com${u.pathname}`;
  } catch {
    return `https://www.linkedin.com/jobs/view/${id}`;
  }
}

/** Cards of one search-results page, normalized to scanner offers. */
export function parseSearchCards(html) {
  const offers = [];
  const seen = new Set();
  for (const block of html.split(/<li[\s>]/).slice(1)) {
    const id = block.match(/urn:li:jobPosting:(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    const title = block.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    const company = block.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/)?.[1];
    if (!title || !company) continue;
    seen.add(id);
    const href = block.match(/base-card__full-link[^>]*href="([^"]+)"/)?.[1]
      ?? block.match(/href="([^"]*\/jobs\/view\/[^"]+)"/)?.[1];
    offers.push({
      id,
      url: href ? cleanJobUrl(href, id) : `https://www.linkedin.com/jobs/view/${id}`,
      title: decodeHtml(title),
      company: decodeHtml(company),
      location: decodeHtml(block.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''),
      postedAt: block.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ?? '',
      source: 'linkedin',
    });
  }
  return offers;
}

/** Plain-text JD from a jobPosting response, or '' when the markup is not recognized. */
export function parseJobPosting(html) {
  const body = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1];
  if (!body) return '';
  return decodeHtml(body.replace(/<br\s*\/?>|<\/(p|li|ul)>/gi, '\n').replace(/<li[^>]*>/gi, '- '));
}

export async function fetchJobPosting(id, options) {
  return parseJobPosting(await politeFetch(buildJobPostingUrl(id), options));
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

function positiveInt(args, flag, fallback, max = Infinity) {
  const v = flagValue(args, flag);
  if (v === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(v) || Number(v) > max) {
    console.error(`Error: ${flag} needs a whole number from 1 to ${max === Infinity ? 'any' : max}`);
    process.exit(1);
  }
  return Number(v);
}

async function main(args) {
  const delayMs = Number(flagValue(args, '--delay-ms') ?? 3000);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    console.error('Error: --delay-ms needs a non-negative number');
    process.exit(1);
  }

  const jdId = flagValue(args, '--jd');
  if (jdId !== undefined) {
    const jd = await fetchJobPosting(jdId);
    if (!jd) { console.error('No JD text found for that id.'); process.exit(1); }
    console.log(jd);
    return;
  }

  const dryRun = args.includes('--dry-run');
  const pages = positiveInt(args, '--pages', 1, MAX_PAGES);
  const sinceDays = positiveInt(args, '--since-days', null);
  const portals = loadPortals();
  const searches = loadSearches(portals);
  if (searches.length === 0) {
    console.error('No linkedin_searches in portals.yml. Add entries like { keywords: "platform engineer", location: "Auckland, New Zealand" }.');
    process.exit(1);
  }

  const gate = createLocalGate({ config: portals });
  const added = [];
  let found = 0;
  let errors = 0;
  let requests = 0;

  for (const search of searches) {
    for (let page = 0; page < pages; page++) {
      if (requests++ > 0) await sleep(delayMs);
      const url = buildSearchUrl(search, { page, sinceDays });
      let offers;
      try {
        offers = parseSearchCards(await politeFetch(url));
      } catch (err) {
        errors++;
        console.warn(`⚠️  ${search.keywords}: ${err.message}`);
        break;
      }
      found += offers.length;
      for (const offer of offers) {
        if (gate.check(offer)) continue;
        added.push(offer);
        console.log(`  ✅ ${offer.company} — ${offer.title}`);
      }
      if (offers.length < PAGE_SIZE) break;
    }
  }

  if (!dryRun) {
    if (added.length > 0) {
      await appendToPipeline(added);
      await appendToScanHistory(added, localToday(), 'added');
    }
    await writeRunLog({ found, counts: gate.counts, newAdded: added.length, queries: requests, errors });
  }

  printScanSummaryHeader('LinkedIn Scan', localToday());
  console.log(`Requests:           ${requests}`);
  console.log(`Postings fetched:   ${found}`);
  console.log(`New offers:         ${added.length}${dryRun ? ' (dry run, nothing written)' : ''}`);
  const skipped = formatLocalSkips(gate.counts);
  if (skipped) console.log(`Skipped:            ${skipped}`);
  if (errors) console.log(`Errors:             ${errors}`);
  if (errors > 0 && found === 0) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, {
    valueFlags: ['--pages', '--since-days', '--delay-ms', '--jd'],
    requireOperand: true,
  });
  main(args).catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}
