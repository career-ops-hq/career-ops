#!/usr/bin/env node
// @ts-check
/**
 * scan-dayforce.mjs — Dayforce (Ceridian) Recruiting scanner via Playwright
 *
 * Dayforce's job-search API sits behind Cloudflare (`cf_clearance`/`__cf_bm`
 * cookies) plus a NextAuth CSRF token. A bare Node `fetch()` — even with a
 * spoofed browser User-Agent/Origin/Referer — gets a hard 403; a real
 * Chromium session against the same endpoint gets 200 every time (confirmed
 * live, 2026-09-02). So this does NOT fit scan.mjs's HTTP-only provider
 * contract (`providers/*.mjs`, ctx.fetchJson/fetchText/fetchResponse, no
 * browser) — it's a standalone script, same architectural pattern as
 * scan-interamt.mjs (Interamt.de, also Playwright-driven because its host
 * has no bare-HTTP-reachable API).
 *
 * Flow per (tenant, jobBoardCode, culture) board:
 *   1. page.goto() the canonical board URL — bootstraps the Cloudflare
 *      cookies and the NextAuth session automatically via the browser.
 *   2. GET /api/auth/csrf via page.request (Playwright's APIRequestContext
 *      bound to the page's BrowserContext — it shares that context's cookie
 *      jar automatically, so the request rides the session bootstrapped in
 *      step 1 without the CORS/CSP exposure of a page.evaluate(fetch)).
 *   3. POST /api/geo/{tenant}/jobposting/search with X-CSRF-TOKEN, paginating
 *      by the *returned* offset+count (never a hardcoded +25) until
 *      offset+count >= maxCount or a short/empty page comes back.
 *   4. Only for postings that already pass the title/location filter against
 *      the list-level jobDescription: GET the per-posting detail endpoint for
 *      the full JD text. This is an explicit design requirement from the
 *      issue (#3726), not an optimization — minimize load on the browser
 *      session by never fetching detail for a posting that would be filtered
 *      out anyway.
 *
 * Session hygiene: never persists cf_clearance/session cookies to disk —
 * each run launches a fresh browser context per tenant and closes it when
 * that tenant is done. On 403/429 the context is discarded and a fresh one
 * is bootstrapped for one retry rather than hammering the stale session.
 *
 * Reads `dayforce_boards` from portals.yml:
 *   dayforce_boards:
 *     - tenant: gnghcm
 *       board: CANDIDATEPORTAL   # jobBoardCode; optional, default CANDIDATEPORTAL
 *       culture: en-US           # optional, default en-US
 *       jobBoardId: 1            # optional, default 1 — see NOTE below
 *
 * NOTE on jobBoardId: the detail endpoint's path segment
 * `/jobposting/{tenant}/{culture}/{jobBoardId}/{jobPostingId}` uses a small
 * integer distinct from jobBoardCode (a string like CANDIDATEPORTAL). This
 * was confirmed to exist and be small (e.g. `1`) but not confirmed across
 * every tenant this session — if a tenant's detail fetches all 404, set
 * `jobBoardId` explicitly in portals.yml for that entry.
 *
 * Usage:
 *   node scan-dayforce.mjs
 *   node scan-dayforce.mjs --dry-run
 *   node scan-dayforce.mjs --debug
 *   node scan-dayforce.mjs --tenant gnghcm   # scan a single configured tenant
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import {
  appendToPipeline,
  appendToScanHistory,
  loadSeenUrls,
  normalizeUrlForDedup,
  buildTitleFilter,
  buildLocationFilter,
  PORTALS_PATH,
} from './scan.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { htmlToText } from './providers/_html-to-text.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';

// ── Constants ────────────────────────────────────────────────────────

export const ALLOWED_HOST = 'jobs.dayforcehcm.com';
const DEFAULT_BOARD_CODE = 'CANDIDATEPORTAL';
const DEFAULT_CULTURE = 'en-US';
const DEFAULT_JOB_BOARD_ID = '1';
const MAX_PAGES_PER_BOARD = 200; // 25/page observed → 5000 postings ceiling; a real cap, not a magic number
const RETRY_DELAY_MS = 3000;

const DATA_ROOT = getCareerOpsRoot();

// Alphanumeric + `_`/`-` only — same discipline as providers/_trust-validator.mjs
// and the SSRF/injection guard every other provider in this codebase applies
// before interpolating an operator-supplied value into a URL.
const TENANT_RE = /^[A-Za-z0-9_-]+$/;
const BOARD_CODE_RE = /^[A-Za-z0-9_-]+$/;
const CULTURE_RE = /^[a-z]{2}-[A-Z]{2}$/;
const JOB_BOARD_ID_RE = /^\d+$/;
const JOB_POSTING_ID_RE = /^\d+$/;

// ── Validation ───────────────────────────────────────────────────────

/** @param {unknown} v */
export function validateTenant(v) {
  return typeof v === 'string' && TENANT_RE.test(v);
}

/** @param {unknown} v */
export function validateBoardCode(v) {
  return typeof v === 'string' && BOARD_CODE_RE.test(v);
}

/** @param {unknown} v */
export function validateCulture(v) {
  return typeof v === 'string' && CULTURE_RE.test(v);
}

/** @param {unknown} v */
export function validateJobBoardId(v) {
  return typeof v === 'string' && JOB_BOARD_ID_RE.test(v);
}

/** @param {unknown} v */
export function validateJobPostingId(v) {
  const s = typeof v === 'number' ? String(v) : v;
  return typeof s === 'string' && JOB_POSTING_ID_RE.test(s);
}

/**
 * Validate and normalize one portals.yml `dayforce_boards` entry.
 * Returns null (never throws) for a malformed entry so one bad row does not
 * abort the whole scan — the caller logs and skips it.
 *
 * @param {any} entry
 * @returns {{ tenant: string, board: string, culture: string, jobBoardId: string } | null}
 */
export function normalizeBoardEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const tenant = entry.tenant;
  const board = entry.board || entry.jobBoardCode || DEFAULT_BOARD_CODE;
  const culture = entry.culture || DEFAULT_CULTURE;
  const jobBoardId = entry.jobBoardId !== undefined && entry.jobBoardId !== null
    ? String(entry.jobBoardId)
    : DEFAULT_JOB_BOARD_ID;

  if (!validateTenant(tenant)) return null;
  if (!validateBoardCode(board)) return null;
  if (!validateCulture(culture)) return null;
  if (!validateJobBoardId(jobBoardId)) return null;

  return { tenant, board, culture, jobBoardId };
}

/**
 * Parse a URL and assert it is exactly https://jobs.dayforcehcm.com — pins
 * the host so a redirect or a crafted response field can never send a
 * request (or a job link handed to the user) to another host.
 *
 * Exported for tests; every URL builder below routes through it.
 *
 * @param {string} url
 */
export function assertDayforceUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) {
    throw new Error(`Refusing non-Dayforce URL: ${url}`);
  }
  return parsed;
}

// ── URL builders ─────────────────────────────────────────────────────

/** @param {string} culture @param {string} tenant @param {string} board */
export function buildBoardUrl(culture, tenant, board) {
  const url = `https://${ALLOWED_HOST}/${culture}/${tenant}/${board}`;
  assertDayforceUrl(url);
  return url;
}

/** @param {string} culture @param {string} tenant @param {string} board @param {string|number} jobPostingId */
export function buildJobUrl(culture, tenant, board, jobPostingId) {
  const url = `https://${ALLOWED_HOST}/${culture}/${tenant}/${board}/jobs/${jobPostingId}`;
  assertDayforceUrl(url);
  return url;
}

export function buildCsrfUrl() {
  return `https://${ALLOWED_HOST}/api/auth/csrf`;
}

/** @param {string} tenant */
export function buildSearchUrl(tenant) {
  const url = `https://${ALLOWED_HOST}/api/geo/${tenant}/jobposting/search`;
  assertDayforceUrl(url);
  return url;
}

/** @param {string} tenant @param {string} culture @param {string} jobBoardId @param {string|number} jobPostingId */
export function buildDetailUrl(tenant, culture, jobBoardId, jobPostingId) {
  const url = `https://${ALLOWED_HOST}/api/geo/${tenant}/jobposting/${tenant}/${culture}/${jobBoardId}/${jobPostingId}`;
  assertDayforceUrl(url);
  return url;
}

// ── Pagination ───────────────────────────────────────────────────────

/**
 * Compute the next `paginationStart`, or null when the board is exhausted.
 * Always advances by the *returned* offset+count (never a hardcoded step),
 * per the issue spec — the list endpoint's own accounting is the only
 * trustworthy stop condition.
 *
 * @param {number} offset
 * @param {number} count
 * @param {number} maxCount
 * @returns {number | null}
 */
export function nextPaginationStart(offset, count, maxCount) {
  if (!Number.isFinite(offset) || !Number.isFinite(count) || !Number.isFinite(maxCount)) return null;
  if (count <= 0) return null; // empty/short page — nothing more to fetch
  const next = offset + count;
  if (next >= maxCount) return null;
  return next;
}

// ── Location / description shaping ──────────────────────────────────

/**
 * Join postingLocations[] into one display string. Prefers each location's
 * formattedAddress; falls back to [city, state, country] when absent (either
 * field can legitimately be missing per-location, not just board-wide).
 *
 * @param {any[] | undefined} postingLocations
 * @returns {string}
 */
export function joinLocations(postingLocations) {
  if (!Array.isArray(postingLocations) || postingLocations.length === 0) return '';
  const parts = postingLocations.map(loc => {
    if (!loc || typeof loc !== 'object') return '';
    if (typeof loc.formattedAddress === 'string' && loc.formattedAddress.trim()) {
      return loc.formattedAddress.trim();
    }
    return [loc.cityName, loc.stateCode, loc.isoCountryCode].filter(Boolean).join(', ');
  }).filter(Boolean);
  return parts.join(' | ');
}

/**
 * Concatenate header→body→footer JD content. Any of the three can
 * legitimately be empty — don't assume all are populated. Runs the shared
 * htmlToText pipeline once over the joined text (safe on plain-text pieces
 * too: no tags to strip, entities still decode, whitespace still collapses).
 *
 * @param {{ jobDescriptionHeader?: string, jobDescription?: string, jobDescriptionFooter?: string } | undefined} content
 * @returns {string}
 */
export function buildJobDescriptionText(content) {
  if (!content || typeof content !== 'object') return '';
  const pieces = [content.jobDescriptionHeader, content.jobDescription, content.jobDescriptionFooter]
    .filter(p => typeof p === 'string' && p.trim());
  return htmlToText(pieces.join('\n\n'));
}

// ── Args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DEBUG = args.includes('--debug');
const tenantIdx = args.indexOf('--tenant');
if (tenantIdx !== -1 && (args[tenantIdx + 1] === undefined || args[tenantIdx + 1].startsWith('--'))) {
  console.error('Error: --tenant requires a value, e.g. --tenant gnghcm');
  process.exit(1);
}
const SINGLE_TENANT = tenantIdx !== -1 ? args[tenantIdx + 1] : null;

// ── Load portals.yml ─────────────────────────────────────────────────

let config = {};
if (existsSync(PORTALS_PATH)) {
  config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
}

const rawBoards = Array.isArray(config.dayforce_boards) ? config.dayforce_boards : [];
const boards = rawBoards
  .map(normalizeBoardEntry)
  .filter(Boolean)
  .filter(b => !SINGLE_TENANT || b.tenant === SINGLE_TENANT);

const invalidCount = rawBoards.length - rawBoards.map(normalizeBoardEntry).filter(Boolean).length;

const titleFilter = buildTitleFilter(config.title_filter);
const locationFilter = buildLocationFilter(config.location_filter);

// ── Fetch helpers (all run through page.request — same context, same cookies) ──

/**
 * @param {import('playwright').Page} page
 */
async function fetchCsrfToken(page) {
  const resp = await page.request.get(buildCsrfUrl());
  if (!resp.ok()) throw new Error(`csrf fetch failed: HTTP ${resp.status()}`);
  const json = await resp.json();
  if (!json || typeof json.csrfToken !== 'string' || !json.csrfToken) {
    throw new Error('csrf response missing csrfToken');
  }
  return json.csrfToken;
}

/**
 * @param {import('playwright').Page} page
 * @param {{ tenant: string, board: string, culture: string }} boardCfg
 * @param {string} csrfToken
 * @param {number} paginationStart
 */
async function fetchSearchPage(page, boardCfg, csrfToken, paginationStart) {
  const resp = await page.request.post(buildSearchUrl(boardCfg.tenant), {
    headers: { 'X-CSRF-TOKEN': csrfToken, 'Content-Type': 'application/json' },
    data: {
      clientNamespace: boardCfg.tenant,
      jobBoardCode: boardCfg.board,
      cultureCode: boardCfg.culture,
      distanceUnit: 0,
      paginationStart,
    },
  });
  if (resp.status() === 403 || resp.status() === 429) {
    const err = new Error(`search HTTP ${resp.status()}`);
    // @ts-ignore
    err.retriable = true;
    throw err;
  }
  if (!resp.ok()) throw new Error(`search fetch failed: HTTP ${resp.status()}`);
  return resp.json();
}

/**
 * @param {import('playwright').Page} page
 * @param {{ tenant: string, culture: string, jobBoardId: string }} boardCfg
 * @param {string|number} jobPostingId
 */
async function fetchDetail(page, boardCfg, jobPostingId) {
  const resp = await page.request.get(buildDetailUrl(boardCfg.tenant, boardCfg.culture, boardCfg.jobBoardId, jobPostingId));
  if (resp.status() === 404 || resp.status() === 410) return null; // closed between list and detail — skip, don't abort
  if (resp.status() === 403 || resp.status() === 429) {
    const err = new Error(`detail HTTP ${resp.status()}`);
    // @ts-ignore
    err.retriable = true;
    throw err;
  }
  if (!resp.ok()) throw new Error(`detail fetch failed: HTTP ${resp.status()}`);
  return resp.json();
}

// ── Per-board scan ───────────────────────────────────────────────────

/**
 * @param {import('playwright').Page} page
 * @param {{ tenant: string, board: string, culture: string, jobBoardId: string }} boardCfg
 */
async function scanBoard(page, boardCfg) {
  const found = [];
  const boardUrl = buildBoardUrl(boardCfg.culture, boardCfg.tenant, boardCfg.board);

  await page.goto(boardUrl, { waitUntil: 'networkidle', timeout: 30000 });

  if (DEBUG) {
    const debugDir = join(DATA_ROOT, 'output');
    mkdirSync(debugDir, { recursive: true });
    const debugPng = join(debugDir, `debug-dayforce-${boardCfg.tenant}.png`);
    await page.screenshot({ path: debugPng, fullPage: true }).catch(() => null);
    console.log(`  [debug] screenshot → ${debugPng}`);
    console.log(`  [debug] url: ${page.url()}`);
  }

  const csrfToken = await fetchCsrfToken(page);

  let paginationStart = 0;
  let pageCount = 0;
  const listRows = [];

  while (pageCount < MAX_PAGES_PER_BOARD) {
    const data = await fetchSearchPage(page, boardCfg, csrfToken, paginationStart);
    const rows = Array.isArray(data.jobPostings) ? data.jobPostings : [];
    listRows.push(...rows);
    pageCount++;

    const next = nextPaginationStart(Number(data.offset), Number(data.count), Number(data.maxCount));
    if (next === null) break;
    paginationStart = next;
  }
  if (DEBUG) console.log(`  [debug] ${boardCfg.tenant}: ${listRows.length} listing row(s) across ${pageCount} page(s)`);

  // Filter pass on list-level data only — zero extra requests for anything
  // that would be filtered out anyway (explicit design requirement, #3726).
  const shortlisted = [];
  const titleSkipped = [];
  const locationSkipped = [];

  for (const row of listRows) {
    // Titles arrive HTML-entity-escaped (e.g. "Strategy &amp; Acquisition") —
    // decode without stripMarkup's tag handling, since a title is plain text.
    const title = decodeEntities(String(row.jobTitle || row.title || '')).trim();
    const jobPostingId = row.jobPostingId ?? row.id;
    if (!title || !validateJobPostingId(jobPostingId)) continue;

    const listLocation = joinLocations(row.postingLocations);
    const listDescription = htmlToText(row.jobDescription || '');
    const url = buildJobUrl(boardCfg.culture, boardCfg.tenant, boardCfg.board, jobPostingId);

    if (!titleFilter(title)) { titleSkipped.push({ title, url, location: listLocation }); continue; }
    if (!locationFilter(listLocation, url, title)) { locationSkipped.push({ title, url, location: listLocation }); continue; }

    shortlisted.push({ jobPostingId, title, listLocation, listDescription, url });
  }

  // Detail fetch only for the shortlist.
  for (const item of shortlisted) {
    const detail = await fetchDetail(page, boardCfg, item.jobPostingId);
    if (!detail) continue; // 404/410 — closed between list and detail

    const description = buildJobDescriptionText(detail.jobPostingContent) || item.listDescription;
    const location = joinLocations(detail.postingLocations) || item.listLocation;
    const postedAt = detail.postingStartTimestampUTC ? Date.parse(detail.postingStartTimestampUTC) : undefined;

    found.push({
      url: item.url,
      company: boardCfg.tenant,
      title: decodeEntities(String(detail.jobTitle || item.title)),
      location,
      source: 'dayforce',
      description,
      postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
    });
  }

  return { found, titleSkipped, locationSkipped, totalFound: listRows.length };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(join(DATA_ROOT, 'data'), { recursive: true });

  if (invalidCount > 0) {
    console.log(`  Skipping ${invalidCount} malformed dayforce_boards entr${invalidCount === 1 ? 'y' : 'ies'} (bad tenant/board/culture/jobBoardId)`);
  }
  if (boards.length === 0) {
    console.log('  No dayforce_boards configured in portals.yml (or none matched --tenant). Nothing to scan.');
    console.log('  Add a dayforce_boards: section — see scan-dayforce.mjs header comment for the shape.');
    return;
  }

  const { seen } = loadSeenUrls();
  const date = localToday();

  let totalFound = 0;
  const newOffers = [];
  const titleSkipped = [];
  const locationSkipped = [];
  const dupeSkipped = [];
  const errors = [];

  for (const boardCfg of boards) {
    process.stdout.write(`  Scanning ${boardCfg.tenant}/${boardCfg.board}... `);

    let attempt = 0;
    let result = null;
    while (attempt < 2 && !result) {
      attempt++;
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        result = await scanBoard(page, boardCfg);
      } catch (err) {
        // @ts-ignore
        if (err && err.retriable && attempt < 2) {
          if (DEBUG) console.log(`\n  [debug] ${boardCfg.tenant}: ${err.message} — re-bootstrapping session and retrying once`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        } else {
          errors.push({ tenant: boardCfg.tenant, error: err.message });
        }
      } finally {
        await context.close();
        await browser.close();
      }
    }

    if (!result) {
      process.stdout.write('ERROR\n');
      continue;
    }

    totalFound += result.totalFound;
    process.stdout.write(`${result.totalFound} found, ${result.found.length} passed filters\n`);

    for (const skip of result.titleSkipped) { seen.add(normalizeUrlForDedup(skip.url)); titleSkipped.push({ ...skip, source: 'dayforce', company: boardCfg.tenant }); }
    for (const skip of result.locationSkipped) { seen.add(normalizeUrlForDedup(skip.url)); locationSkipped.push({ ...skip, source: 'dayforce', company: boardCfg.tenant }); }

    for (const offer of result.found) {
      const key = normalizeUrlForDedup(offer.url);
      if (seen.has(key)) { dupeSkipped.push(offer); continue; }
      seen.add(key);
      newOffers.push(offer);
    }
  }

  if (!DRY_RUN) {
    if (newOffers.length > 0) await appendToPipeline(newOffers);
    if (newOffers.length > 0) await appendToScanHistory(newOffers, date, 'added');
    if (titleSkipped.length > 0) await appendToScanHistory(titleSkipped, date, 'skipped_title');
    if (locationSkipped.length > 0) await appendToScanHistory(locationSkipped, date, 'skipped_location');
    if (dupeSkipped.length > 0) await appendToScanHistory(dupeSkipped, date, 'skipped_dup');
  }

  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Dayforce Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Boards scanned:     ${boards.length}`);
  console.log(`Total found:        ${totalFound}`);
  console.log(`Filtered by title:  ${titleSkipped.length}`);
  console.log(`Filtered location:  ${locationSkipped.length}`);
  console.log(`Duplicates:         ${dupeSkipped.length}`);
  console.log(`New offers:         ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e.tenant}: ${e.error}`);
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (DRY_RUN) {
      console.log('\n(dry run — not saved)');
    } else {
      console.log('\nSaved to data/pipeline.md');
    }
  }

  console.log('\n→ Run /career-ops pipeline to evaluate new offers.');
}

// Guarded like every sibling scanner (scan-hn.mjs, scan-interamt.mjs,
// scan-ats-full.mjs) — merely importing this module must not drive a live
// browser scan and mutate the user's pipeline/scan history as a side effect
// of the import (#3510).
if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
