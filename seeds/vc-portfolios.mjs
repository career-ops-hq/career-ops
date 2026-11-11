// @ts-check
/**
 * seeds/vc-portfolios.mjs — VC portfolio seed fetchers for career-ops.
 *
 * Pulls public VC portfolio company lists (Y Combinator, Andreessen Horowitz)
 * and emits company entries compatible with the existing ATS scan/discovery
 * path (same shape as tracked_companies entries in portals.yml).
 *
 * Design constraints:
 *  - Zero auth — public sources only, no login, no API keys.
 *  - Zero LLM tokens — pure HTTP + JSON / HTML.
 *  - Same SLUG_RE guard used by scan-ats-full.mjs for every slug that reaches
 *    URL interpolation — a tampered or malformed payload can never inject
 *    unexpected characters into a URL.
 *  - `parseSeedEntries()` is a pure, synchronous function (no network) so it
 *    can be unit-tested with inline fixtures without any mocking.
 *
 * Typical usage (via scan-ats-full.mjs --seeds flag):
 *   node scan-ats-full.mjs --seeds yc
 *   node scan-ats-full.mjs --seeds yc,a16z --since 7 --dry-run
 *
 * Direct usage:
 *   import { fetchYCCompanies, fetchA16zCompanies } from './seeds/vc-portfolios.mjs';
 *   const companies = await fetchYCCompanies();
 */

import { DEFAULT_USER_AGENT } from '../user-agent.mjs';
import { decodeEntities } from '../providers/_html-entities.mjs';

// ── Constants ────────────────────────────────────────────────────────

/**
 * Safe charset for slug values that will be interpolated into ATS URLs.
 * Consistent with the SLUG_RE guard in scan-ats-full.mjs.
 */
export const SLUG_RE = /^[A-Za-z0-9._-]+$/;

const DEFAULT_TIMEOUT_MS = 20_000;

// Runaway guard for the YC pagination walk, NOT the stop condition: the walk
// normally ends at the API's own `totalPages`, which grows with every batch
// (read it from the API rather than from here). This guard exists only for the
// case where the API stops reporting pagination metadata at all. Sized well
// clear of the real total on purpose - a ceiling that sits
// close to today's page count stops being a guard and becomes a silent truncation
// the day the catalogue grows past it, which is the exact failure this file was
// fixed for. Exported so the walk is clamped to it as a hard ceiling and tests
// can assert the contract.
export const YC_MAX_PAGES = 500;

/**
 * YC public company API (no auth). Paginated JSON: `{ companies, page,
 * totalPages, nextPage }`, each company with name, slug, website, batch.
 */
const YC_API_BASE = 'https://api.ycombinator.com/v0.1/companies';

/**
 * a16z public portfolio page.
 * The portfolio is a publicly accessible HTML page listing all portfolio companies.
 */
const A16Z_PORTFOLIO_URL = 'https://a16z.com/portfolio/';

// ── HTTP helper (local — avoids importing providers/_http.mjs to keep seeds/ self-contained) ──

/**
 * Minimal fetch wrapper with timeout + user-agent header.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': DEFAULT_USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      const snippet = await res.text().catch(() => '').then(t => t.slice(0, 200));
      throw new Error(`HTTP ${res.status}${snippet ? ': ' + snippet.replace(/\s+/g, ' ').trim() : ''}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Shared types (JSDoc only — no runtime cost) ──────────────────────

/**
 * A single VC-portfolio company entry — the output unit of both seed fetchers.
 *
 * @typedef {object} SeedCompany
 * @property {string}   name            Display name, e.g. "Stripe".
 * @property {string}   slug            URL-safe slug, validated against SLUG_RE.
 * @property {string}   url             Company website URL.
 * @property {string}   [ats]           ATS platform if detectable: 'greenhouse' | 'lever' | 'ashby'.
 * @property {string}   [ats_id]        ATS board/org slug for URL construction.
 * @property {string}   [source]        Which VC list this came from: 'yc' | 'a16z'.
 * @property {string}   [batch]         YC batch label, e.g. "W21" (YC only).
 */

/**
 * A PortalEntry-compatible object ready to be passed to ATS provider.detect().
 * Shape matches the PortalEntry typedef in providers/_types.js.
 *
 * @typedef {object} SeedPortalEntry
 * @property {string} name
 * @property {string} careers_url   Best-effort ATS or website URL.
 * @property {string} [source]      Seed origin ('yc' | 'a16z').
 */

// ── Pure parser: YC ──────────────────────────────────────────────────

/**
 * Parse a raw YC API response payload into SeedCompany entries.
 *
 * This is the testable unit — pure, no network, no side effects.
 * The YC API returns a paginated JSON object:
 *   { companies: [{ id, name, slug, website, batch, ... }], ... }
 *
 * @param {unknown} payload   Parsed JSON from the YC API (or a fixture in tests).
 * @returns {SeedCompany[]}
 */
export function parseYCPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const raw = /** @type {any} */ (payload);
  const list = Array.isArray(raw.companies) ? raw.companies : (Array.isArray(raw) ? raw : []);
  /** @type {Map<string, SeedCompany>} */
  const seen = new Map();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;

    // Prefer explicit slug; derive from name as fallback.
    const rawSlug = typeof item.slug === 'string' ? item.slug.trim()
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!rawSlug || !SLUG_RE.test(rawSlug)) continue;

    // Deduplicate by slug.
    if (seen.has(rawSlug)) continue;

    const url = typeof item.website === 'string' && item.website.startsWith('http')
      ? item.website.trim()
      : (typeof item.url === 'string' && item.url.startsWith('http') ? item.url.trim() : '');

    /** @type {SeedCompany} */
    const entry = {
      name,
      slug: rawSlug,
      url,
      source: 'yc',
    };

    if (typeof item.batch === 'string' && item.batch.trim()) {
      entry.batch = item.batch.trim();
    }

    seen.set(rawSlug, entry);
  }

  return [...seen.values()];
}

// ── Pure parser: a16z ────────────────────────────────────────────────

/**
 * Where a16z.com/portfolio/ keeps its company list. The page carries the whole
 * portfolio twice, with the same ids:
 *
 *  1. A `data-companies="[...]"` attribute on the portfolio grid: HTML-escaped
 *     JSON with `name` / `display_name`, `status`, `acquirer`, `company_url`.
 *  2. An inline `<script>window.a16z_portfolio_companies = [...];</script>`:
 *     plain JSON with `title`, `web` and `acquirer`, but no status, and some
 *     titles are legal names ("Groupon, Inc.").
 *
 * The attribute is read first because its names are the display names a slug
 * is derived from; the script is the fallback for when the attribute goes.
 * The page also has a logo ticker of about 20 single `data-company='{...}'`
 * objects. That is a showcase, not the list, and neither reader matches it.
 */
const A16Z_DATA_ATTR_RE = /\sdata-companies="([^"]*)"/;
const A16Z_SCRIPT_MARKER_RE = /window\.a16z_portfolio_companies\s*=\s*/;

/**
 * @param {string} text
 * @returns {any[] | null}  The parsed array, or null when it is not one.
 */
function parseJsonArray(text) {
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Read the company array from the `data-companies` attribute. The value is
 * decoded once, then parsed: a quote inside a JSON string arrives as `\&quot;`
 * and decodes to `\"`, which is still valid JSON.
 *
 * @param {string} html
 * @returns {any[] | null}
 */
function readA16zDataAttribute(html) {
  const m = html.match(A16Z_DATA_ATTR_RE);
  return m ? parseJsonArray(decodeEntities(m[1])) : null;
}

/**
 * Read the company array from the inline `window.a16z_portfolio_companies`
 * script. The array ends at the script's `;</script>`, so the slice runs to the
 * closing tag and drops the statement's trailing semicolon before parsing.
 * WordPress escapes `/` inside JSON strings, so a `</script>` cannot appear
 * inside the array itself.
 *
 * @param {string} html
 * @returns {any[] | null}
 */
function readA16zInlineScript(html) {
  const m = A16Z_SCRIPT_MARKER_RE.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) return null;
  return parseJsonArray(html.slice(start, end).trim().replace(/;$/, ''));
}

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The company's own website. `url` on the attribute list is the a16z profile
 * page for companies with no site of their own, so it only counts when it is
 * off a16z.com.
 *
 * @param {any} item
 * @returns {string}
 */
function a16zCompanyUrl(item) {
  for (const candidate of [str(item.company_url), str(item.external_url), str(item.web), str(item.url)]) {
    if (!/^https?:\/\//i.test(candidate)) continue;
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (host === 'a16z.com' || host.endsWith('.a16z.com')) continue;
    } catch {
      continue;
    }
    return candidate;
  }
  return '';
}

/**
 * Slug for an a16z company name. About 15 names in the list are legal names
 * ("Groupon, Inc.", "Yuga Labs (BAYC)"), and a board slug never carries the
 * suffix, so a trailing parenthetical and a trailing Inc/LLC/Ltd/Corp are
 * dropped before slugging. The display name keeps them.
 *
 * @param {string} name
 * @returns {string}
 */
function a16zSlug(name) {
  const base = name
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/,?\s+(?:inc|incorporated|llc|ltd|corp)\.?$/i, '');
  return (base || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parse raw a16z portfolio HTML into SeedCompany entries.
 *
 * This is the testable unit — pure, no network, no side effects.
 *
 * Acquired companies (a non-empty `acquirer`) are left out by default: their
 * old job boards are mostly gone, and the hiring now happens at the acquirer.
 * IPO'd companies have no acquirer and stay in.
 *
 * @param {string} html    Raw HTML from the a16z portfolio page (or a fixture in tests).
 * @param {{ includeAcquired?: boolean }} [opts]
 * @returns {SeedCompany[]}
 */
export function parseA16zPayload(html, { includeAcquired = false } = {}) {
  if (typeof html !== 'string' || !html.trim()) return [];

  const list = readA16zDataAttribute(html) ?? readA16zInlineScript(html) ?? [];

  /** @type {Map<string, SeedCompany>} */
  const seen = new Map();

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (!includeAcquired && str(item.acquirer)) continue;

    // `title` comes last: on the script list it is the company name, but on
    // the attribute list it is a tag such as "IPO: FIG", and every attribute
    // entry has a `name` ahead of it.
    const name = str(item.display_name) || str(item.name) || str(item.post_title) || str(item.title);
    if (!name) continue;

    const slug = a16zSlug(name);
    if (!slug || !SLUG_RE.test(slug) || seen.has(slug)) continue;

    seen.set(slug, { name, slug, url: a16zCompanyUrl(item), source: 'a16z' });
  }

  return [...seen.values()];
}

// ── Generic pure parser (entry point for test-all.mjs) ───────────────

/**
 * Parse a raw seed payload (either YC JSON or a16z HTML) into validated
 * SeedCompany entries. This is the universal testable unit cited in the
 * issue acceptance criteria.
 *
 * @param {unknown} payload     JSON object (YC) or HTML string (a16z).
 * @param {'yc'|'a16z'} source  Which VC portfolio this payload came from.
 * @returns {SeedCompany[]}
 */
export function parseSeedEntries(payload, source) {
  if (source === 'a16z') {
    return parseA16zPayload(typeof payload === 'string' ? payload : '');
  }
  // Default: YC (also used for unknown sources — parse defensively).
  return parseYCPayload(payload);
}

// ── toPortalEntry converter ──────────────────────────────────────────

/**
 * Board URL builders for the ATSs a seed company is probed on when its source
 * names no ATS. Neither the YC API nor the a16z page carries one, so this is
 * every seed company.
 *
 * Order is by measured hit rate. Of 300 YC companies sampled across the
 * W21-W27 batches (2026-11-09), the company's own slug was an Ashby board for
 * 25, a Greenhouse board for 4 and a Lever board for 4; none matched two. The
 * probe stops at the first board that exists, so the likeliest goes first.
 *
 * @type {ReadonlyArray<readonly ['ashby' | 'greenhouse' | 'lever', (slug: string) => string]>}
 */
const SLUG_PROBE_ORDER = [
  ['ashby', (slug) => `https://jobs.ashbyhq.com/${slug}`],
  ['greenhouse', (slug) => `https://job-boards.greenhouse.io/${slug}`],
  ['lever', (slug) => `https://jobs.lever.co/${slug}`],
];

/**
 * Convert a SeedCompany into the PortalEntry-shaped candidates to probe, in
 * order. ATS provider detect() consumes each one directly.
 *
 *  1. `company.ats` + `company.ats_id` set → that one board URL.
 *  2. Otherwise, a valid slug → one candidate per ATS in SLUG_PROBE_ORDER
 *     (Ashby, Greenhouse, Lever). The scan tries them in turn and moves on when
 *     a board answers 404.
 *  3. No slug → the company website (detect() rarely matches it, and the
 *     company is then skipped).
 *
 * @param {SeedCompany} company
 * @returns {SeedPortalEntry[]}
 */
export function toPortalEntries(company) {
  const make = (/** @type {string} */ careers_url) => ({ name: company.name, careers_url, source: company.source });

  const atsId = company.ats_id && SLUG_RE.test(company.ats_id) ? company.ats_id : null;
  if (atsId) {
    const hinted = SLUG_PROBE_ORDER.find(([ats]) => ats === company.ats);
    if (hinted) return [make(hinted[1](atsId))];
  }

  if (company.slug && SLUG_RE.test(company.slug)) {
    const slug = company.slug;
    return SLUG_PROBE_ORDER.map(([, url]) => make(url(slug)));
  }

  return [make(company.url || '')];
}

/**
 * The first candidate from toPortalEntries(): the hinted board, else the
 * Ashby URL for the slug, else the website. Kept for callers that want one
 * entry; the seed scan itself probes every candidate.
 *
 * @param {SeedCompany} company
 * @returns {SeedPortalEntry}
 */
export function toPortalEntry(company) {
  return toPortalEntries(company)[0];
}

// ── Network fetchers ─────────────────────────────────────────────────

/**
 * Fetch the Y Combinator public company list and return parsed SeedCompany entries.
 *
 * Uses the public YC API (no auth, no API key). The response is a JSON object
 * with a `companies` array plus `page`/`totalPages` pagination fields. The API
 * sets the page size server-side and ignores `per_page`, so the whole
 * portfolio is walked page by page, newest batches first. The API carries no
 * ATS field, so every company is probed by slug (see toPortalEntries).
 *
 * @param {{ timeoutMs?: number, maxPages?: number }} [opts] - `maxPages` is
 *   clamped to YC_MAX_PAGES, which is a hard ceiling; pagination normally stops
 *   at the API-reported last page.
 * @returns {Promise<SeedCompany[]>}
 */
export async function fetchYCCompanies({ timeoutMs = DEFAULT_TIMEOUT_MS, maxPages = YC_MAX_PAGES } = {}) {
  /** @type {SeedCompany[]} */
  const all = [];
  const seen = new Set();

  // YC_MAX_PAGES is a hard ceiling: clamp here so an explicit maxPages (or a
  // stray Infinity) can never spin the walk past the runaway guard.
  const limit = Math.min(maxPages, YC_MAX_PAGES);

  let page = 1;
  for (let fetched = 0; fetched < limit; fetched++) {
    const url = `${YC_API_BASE}?page=${page}`;
    let payload;
    try {
      const res = await fetchWithTimeout(url, { timeoutMs });
      payload = await res.json();
    } catch (err) {
      if (page === 1) throw new Error(`vc-portfolios: YC API fetch failed — ${err.message}`);
      break; // Partial data is fine after page 1.
    }

    const entries = parseYCPayload(payload);
    if (entries.length === 0) {
      // An empty first page means the response shape changed, not that YC has
      // no companies; fail the same way a network error on page 1 does.
      if (page === 1) throw new Error('vc-portfolios: YC API page 1 parsed to 0 companies — the response shape has probably changed');
      break; // No more companies.
    }

    for (const e of entries) {
      if (!seen.has(e.slug)) {
        seen.add(e.slug);
        all.push(e);
      }
    }

    // The API sets the page size server-side (per_page is ignored) and reports
    // totalPages — follow its signal instead of guessing from batch size.
    const raw = /** @type {any} */ (payload);
    if (Number.isInteger(raw?.totalPages) && raw.totalPages > 0) {
      if (page >= raw.totalPages) break;
      page += 1;
      continue;
    }
    // When totalPages is absent, follow the nextPage target the API hands back
    // rather than stopping — tolerating a bare number, a page=N fragment, or a
    // full URL, and requiring forward progress so it can't spin. This is the
    // case that bites the day YC changes the response shape again.
    const next = parseYCNextPage(raw?.nextPage);
    if (next == null || next <= page) break;
    page = next;
  }

  return all;
}

/**
 * Extract the next page number from the YC API's `nextPage` field, which may be
 * a bare page number, a `page=N` query fragment, or a full URL carrying a
 * `page=N` query param. Returns null when no forward page number can be read.
 *
 * @param {unknown} nextPage
 * @returns {number | null}
 */
export function parseYCNextPage(nextPage) {
  if (nextPage == null || nextPage === false) return null;
  if (typeof nextPage === 'number') {
    return Number.isInteger(nextPage) && nextPage > 0 ? nextPage : null;
  }
  if (typeof nextPage === 'string') {
    const m = nextPage.match(/(?:^|[?&/])page[=/](\d+)/) || nextPage.match(/^\s*(\d+)\s*$/);
    if (m) {
      const n = Number(m[1]);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  }
  return null;
}

/**
 * Fetch the a16z public portfolio page and return parsed SeedCompany entries.
 *
 * a16z does not expose a public JSON API, so we fetch the HTML portfolio page
 * and parse it with `parseA16zPayload()`.
 *
 * A page that loads but yields no companies throws. The portfolio has hundreds
 * of entries, so zero means the markup moved, and returning [] would make
 * `--seeds a16z` report "0 companies probed" as if the run had worked.
 *
 * @param {{ timeoutMs?: number, includeAcquired?: boolean }} [opts]
 * @returns {Promise<SeedCompany[]>}
 */
export async function fetchA16zCompanies({ timeoutMs = DEFAULT_TIMEOUT_MS, includeAcquired = false } = {}) {
  let html;
  try {
    const res = await fetchWithTimeout(A16Z_PORTFOLIO_URL, { timeoutMs });
    html = await res.text();
  } catch (err) {
    throw new Error(`vc-portfolios: a16z portfolio fetch failed — ${err.message}`);
  }
  const companies = parseA16zPayload(html, { includeAcquired });
  if (companies.length === 0) {
    throw new Error(`vc-portfolios: a16z portfolio page (${html.length} bytes) parsed to 0 companies — the page markup has probably changed`);
  }
  return companies;
}

// ── SEED_SOURCES registry ────────────────────────────────────────────

/**
 * Registry mapping seed source names to their fetch functions.
 * Consumed by scan-ats-full.mjs --seeds flag and CLI tooling.
 *
 * To add a new VC portfolio:
 *  1. Add a fetchXyzCompanies() function above.
 *  2. Add an entry here: { fetch: fetchXyzCompanies, label: 'XYZ Portfolio' }
 *
 * @type {Record<string, { fetch: (opts?: object) => Promise<SeedCompany[]>, label: string }>}
 */
export const SEED_SOURCES = {
  yc: {
    fetch: fetchYCCompanies,
    label: 'Y Combinator Portfolio',
  },
  a16z: {
    fetch: fetchA16zCompanies,
    label: 'Andreessen Horowitz (a16z) Portfolio',
  },
};
