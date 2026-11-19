// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchResponseWithRetry, fetchTextWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { coerceId } from './_ids.mjs';
import { randomBytes, randomInt } from 'node:crypto';
import { markTruncated } from '../lib/board-truncation.mjs';
import { cookieHeaderFrom } from './csod.mjs';

// SAP SuccessFactors "classic" career sites, for `tracked_companies:` — the
// plain `https://career<N>.successfactors.(eu|com)/career?company=<ID>` job
// board that SAP hosts itself, with no branded domain in front of it. It is
// not the Recruiting Marketing (RMK) site `successfactors.mjs` reads: there is
// no /tile-search-results/ fragment and no /services/recruiting/v1/jobs API
// (both answer HTTP 404), only a JavaScript app that talks to the server over
// DWR remoting. Verified live on career5.successfactors.eu (Naturgy).
//
// This is a separate provider, not a mode of `successfactors.mjs`, because the
// two share a vendor and nothing else: different hosts and URL shape, a cookie
// + CSRF session, a protocol parser, and no overlap in code. `successfactors.mjs`
// already holds two transports that are variants of one scraped page
// (RMK/CSB); a third that needs a session bootstrap would have doubled it.
//
// The flow replays what the public search page does for any anonymous visitor;
// no real user's session is involved:
//   1. GET  {origin}/career?company={ID}&navBarLevel=JOB_SEARCH
//      → session cookies (JSESSIONID, route, …), the CSRF key the page embeds
//        (`ajaxSecKey="…"`, which its own script sends back as X-CSRF-Token)
//        and the AjaxService view id.
//   2. POST {origin}/xi/ajax/remoting/call/plaincall/{controller}.{method}.dwr
//      (text/plain DWR body, cookie + CSRF headers):
//        getInitialJobSearchData   → the filter fields and keyword languages
//        updateUserSelectedValues  → the search criteria, kept in the server
//                                    session (here: every language, no filter)
//        search                    → the postings, 50 per call
// The bootstrap GET and the first two DWR calls carry no listings and are
// outside `max_pages`; the first `search` call is page one.
//
// DWR replies are JavaScript ("var s0={};s0.title="x";…"). They are read with a
// tokenizer, never evaluated.
//
// The list carries id, title and posting date, and nothing about place (the
// "(City)" in a title is one employer's habit, not a field), so `location` is
// left empty rather than guessed. A `location_filter` therefore cannot act on
// these rows; use `title_filter` for them.
//
// The posting URL is the public job page, which needs no session:
//   {origin}{detailURLPrefix}{id}, with the prefix's `rcm_site_locale` set to
//   the posting's own default locale.
// That locale (es_ES) is also each job's `language`, as the source names it.
//
// The walk ends on a short or empty page, never on the postingCount the replies carry (it can
// be stale). A page past the end answers with the board's rows again, not an empty list
// (checked live), so a repeated page is the end once the rows read reach that count, and a
// page-ignored partial read otherwise.
//
// `robots.txt` on these hosts disallows any path with a company query. Per the Source Indexing
// Policy it is not a gate (the read is one anonymous visitor's, five requests
// for a small board), but a board that answers a login page, a 403 or a
// challenge is a named failure, never worked around.

const PAGE_SIZE = 50; // the largest size the site's own selector offers
const DEFAULT_MAX_PAGES = 20; // 20 x 50 = 1000 postings
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 250;
const CONTROLLER = 'careerJobSearchControllerProxy';
const FALLBACK_VIEW_ID = '/ui/rcmcareer/pages/careersite/career.jsp.xhtml';

// A SAP-hosted tenant: <label>.successfactors.eu / .com, anchored over the
// whole hostname (the dots escaped, the end anchored).
const HOST_RE = /^[a-z0-9-]+\.successfactors\.(?:eu|com)$/;
const LOCALE_RE = /^[a-z]{2}_[A-Z]{2}$/; // a posting's own default locale, e.g. es_ES
const COMPANY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * True for the URL a visitor of a classic career site holds: a SAP host, the
 * `/career` path and a `company` id. `successfactors.mjs` uses it to leave
 * these URLs to this provider.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isClassicCareerUrl(raw) {
  return resolveConfig({ careers_url: typeof raw === 'string' ? raw : '' }) !== null;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{origin: string, company: string, searchPage: string} | null}
 */
export function resolveConfig(entry) {
  let u;
  try {
    u = new URL(entry?.api || entry?.careers_url || '');
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host)) return null;
  if (u.pathname.replace(/\/+$/, '').toLowerCase() !== '/career') return null;
  const company = u.searchParams.get('company') || '';
  if (!COMPANY_RE.test(company)) return null;
  // Only the host is trusted from the input: the origin and the path are rebuilt.
  const origin = `https://${host}`;
  return { origin, company, searchPage: `/career?company=${encodeURIComponent(company)}&navBarLevel=JOB_SEARCH` };
}

// ── DWR plumbing ─────────────────────────────────────────────────────────────

/**
 * Encode JS values the way DWR's plaincall protocol wants them: scalars inline,
 * containers as `reference:c0-eN` members declared on their own lines.
 * @param {unknown[]} params @returns {string[]}
 */
export function dwrParams(params) {
  /** @type {string[]} */
  const lines = [];
  let n = 0;
  /** @param {any} v @returns {string} */
  const enc = (v) => {
    if (v == null) return 'null:null';
    if (typeof v === 'string') return `string:${encodeURIComponent(v)}`;
    if (typeof v === 'number') return `number:${v}`;
    if (typeof v === 'boolean') return `boolean:${v}`;
    /** @param {any} x */
    const ref = (x) => {
      const id = `c0-e${++n}`;
      lines.push(`${id}=${enc(x)}`);
      return `reference:${id}`;
    };
    if (Array.isArray(v)) return `Array:[${v.map(ref).join(',')}]`;
    return `Object_Object:{${Object.entries(v).map(([k, x]) => `${k}:${ref(x)}`).join(', ')}}`;
  };
  const top = params.map((p, i) => `c0-param${i}=${enc(p)}`);
  return [...lines, ...top];
}

/** @param {string} s */
function unescapeJs(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, e) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    /** @type {Record<string, string>} */
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
    return simple[e] ?? e;
  });
}

/**
 * Read a DWR reply ("var s0={};var s1=[];s0.title="x";s1[0]=s0;") into every
 * object and array it declares, linked up. Throws when the body is not a DWR
 * reply (a login page, a CSRF rejection) or carries a DWR exception.
 * @param {string} text @returns {any[]}
 */
export function parseDwr(text) {
  // Statements start a line: a posting title holding the same words sits inside a string literal.
  if (/^dwr\.engine\._remoteHandleException\(/m.test(text)) {
    const message = /"message":"([^"]*)"/.exec(text)?.[1] || 'unknown';
    throw new Error(`successfactors-classic: DWR error: ${message}`);
  }
  if (!/^dwr\.engine\._remoteHandleCallback\(/m.test(text)) {
    throw new Error('successfactors-classic: reply is not a DWR reply (session or CSRF key rejected, or a login page)');
  }
  // Statements are recognized on a copy whose string literals are blanked to the same length, so a
  // title holding "var s0={};" or "s0.id=5;" is data. Values are read from the original text.
  const code = text.replace(/"(?:[^"\\]|\\.)*"/g, (lit) => `"${' '.repeat(lit.length - 2)}"`);
  /** @type {Map<string, any>} */
  const vars = new Map();
  for (const m of code.matchAll(/var (s\d+)=(\{\}|\[\]);/g)) vars.set(m[1], m[2] === '{}' ? {} : []);
  /** @param {string} tok */
  const val = (tok) => {
    if (tok[0] === '"') return unescapeJs(tok.slice(1, -1));
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    return /^s\d+$/.test(tok) ? vars.get(tok) : Number(tok);
  };
  for (const m of code.matchAll(/(s\d+)(?:\.(\w+)|\['([^']*)'\]|\[(\d+)\])=("(?:[^"\\]|\\.)*"|-?[\d.]+|true|false|null|s\d+);/dg)) {
    const target = vars.get(m[1]);
    const [from, to] = /** @type {number[]} */ (m.indices?.[5]);
    if (target) target[m[2] ?? m[3] ?? m[4]] = val(text.slice(from, to));
  }
  return [...vars.values()];
}

// ── Postings ─────────────────────────────────────────────────────────────────

/**
 * "17/11/2026": day-first unless the data shows month-first (a second part
 * above 12) or the page language is English and nothing in the data says
 * otherwise.
 * @param {string[]} dates @param {string} lang
 * @returns {(d: string) => number | undefined}
 */
export function dateParser(dates, lang) {
  let dayFirst = !/^en/i.test(lang);
  for (const d of dates) {
    const [a, b] = d.split('/').map(Number);
    if (a > 12) { dayFirst = true; break; }
    if (b > 12) { dayFirst = false; break; }
  }
  return (d) => {
    const [a, b, y] = String(d).split('/').map(Number);
    const [day, month] = dayFirst ? [a, b] : [b, a];
    if (!y || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return undefined;
    const ms = Date.UTC(y, month - 1, day);
    return new Date(ms).getUTCDate() === day ? ms : undefined;
  };
}

/**
 * The posting URL: the server's own detail prefix with the posting's locale.
 * @param {string} origin @param {string} prefix @param {any} posting
 * @returns {string | null}
 */
function postingUrl(origin, prefix, posting) {
  const id = coerceId(posting?.id);
  const seg = id === undefined ? null : safeEncodeURIComponent(id);
  if (!seg || !/^\/career\?/.test(prefix)) return null;
  const locale = LOCALE_RE.test(posting.defaultLocale) ? posting.defaultLocale : null;
  const path = prefix
    .replace(/%5f/gi, '_')
    .replace(/(rcm_site_locale=)[A-Za-z_]+/, (_m, k) => (locale ? k + locale : _m));
  return `${origin}${path}${seg}`;
}

/**
 * Map one `search` reply to jobs. Throws when the reply carries no posting
 * list; a present, empty list is an empty board.
 * @param {any[]} objects parsed DWR reply
 * @param {{origin: string, company: string}} cfg
 * @param {string} companyName
 * @param {string} lang the page's language, for the date format
 * @returns {{jobs: any[], rawCount: number, total: number | null, keys: string[]}} `keys` identifies each
 *   row the source returned (id and title), before any is dropped, for repeated-page detection
 */
export function parseSearchReply(objects, cfg, companyName, lang) {
  const results = objects.find((o) => o && !Array.isArray(o) && Array.isArray(o.postings));
  if (!results) {
    throw new Error('successfactors-classic: no postings list in the search reply (protocol changed?)');
  }
  const total = Number.isInteger(results.postingCount) ? results.postingCount : null;
  const prefix = typeof results.detailURLPrefix === 'string' ? results.detailURLPrefix : '';
  const rows = results.postings.filter((p) => p && typeof p === 'object');
  // Postings with no prefix to build their links from would all be dropped below and the page
  // would read as an empty or short one: that is a broken reply, not an empty board.
  if (rows.length > 0 && !/^\/career\?/.test(prefix)) {
    throw new Error('successfactors-classic: postings present but no usable detailURLPrefix in the search reply (protocol changed?)');
  }
  const toMs = dateParser(rows.map((p) => (typeof p.postingDate === 'string' ? p.postingDate : '')).filter(Boolean), lang);
  const jobs = [];
  for (const p of rows) {
    if (typeof p.title !== 'string') continue;
    const title = decodeEntities(p.title).replace(/\s+/g, ' ').trim();
    const url = postingUrl(cfg.origin, prefix, p);
    if (!title || !url) continue;
    const postedAt = typeof p.postingDate === 'string' ? toMs(p.postingDate) : undefined;
    jobs.push({
      title,
      url,
      company: companyName,
      location: '',
      ...(postedAt !== undefined ? { postedAt } : {}),
      ...(LOCALE_RE.test(p.defaultLocale) ? { language: p.defaultLocale } : {}),
      listingIdentity: { ats_provider: 'successfactors-classic', board_slug: cfg.company, posting_id: String(coerceId(p.id)) },
    });
  }
  const keys = rows.map((p) => `${typeof p.id === 'string' || typeof p.id === 'number' ? p.id : ''}|${typeof p.title === 'string' ? p.title : ''}`);
  return { jobs, rawCount: results.postings.length, total, keys };
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'successfactors-classic',

  // Claims the URL a visitor holds: a SAP host, /career and ?company=. It sorts
  // before `successfactors.mjs`, which leaves these URLs to this provider.
  detect(entry) {
    const url = entry?.api || entry?.careers_url || '';
    return isClassicCareerUrl(url) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`successfactors-classic: cannot resolve a career?company= URL on a successfactors host for ${entry.name}`);

    // Bootstrap: cookies + CSRF key + view id. One anonymous GET, outside max_pages.
    const searchUrl = `${cfg.origin}${cfg.searchPage}`;
    // A health probe (ctx.maxPages) spends a small request budget: no retries there, so a failing
    // board surfaces its own HTTP error instead of exhausting the budget and reading as live.
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const retryPolicy = probing ? { retries: 0 } : {};
    const boot = await fetchResponseWithRetry(ctx, searchUrl, { redirect: 'error', headers: { accept: 'text/html' } }, retryPolicy);
    const html = await boot.text();
    const cookie = cookieHeaderFrom(typeof boot.headers?.getSetCookie === 'function' ? boot.headers.getSetCookie() : []);
    const key = /ajaxSecKey="([^"]+)"/.exec(html)?.[1];
    if (!key) {
      throw new Error(`successfactors-classic: no ajaxSecKey on ${searchUrl} (login page, challenge or changed markup)`);
    }
    const viewId = /AjaxService\.setViewId\('([^']+)'\)/.exec(html)?.[1] || FALLBACK_VIEW_ID;
    const lang = /<html[^>]*\blang="([^"]+)"/i.exec(html)?.[1] || 'en';

    let batch = 0;
    /** @param {string} method @param {string} page @param {unknown[]} params */
    const dwr = async (method, page, params) => {
      // 32 hex digits and a 0-999 counter, from the system CSPRNG.
      const scriptSessionId = randomBytes(16).toString('hex').toUpperCase() + String(randomInt(1000));
      const body = [
        'callCount=1', `page=${page}`, 'httpSessionId=', `scriptSessionId=${scriptSessionId}`,
        `c0-scriptName=${CONTROLLER}`, 'c0-methodName=' + method, 'c0-id=0',
        ...dwrParams(params), `batchId=${batch++}`, '',
      ].join('\n');
      const text = await fetchTextWithRetry(ctx, `${cfg.origin}/xi/ajax/remoting/call/plaincall/${CONTROLLER}.${method}.dwr`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'text/plain',
          accept: '*/*',
          origin: cfg.origin,
          referer: searchUrl,
          'x-csrf-token': key,
          'x-ajax-token': key,
          viewid: viewId,
          'x-subaction': '0',
          'x-sap-page-info': `companyId=${cfg.company}`,
          ...(cookie ? { cookie } : {}),
        },
        body,
      }, retryPolicy);
      return parseDwr(text);
    };

    // The filter fields and the keyword languages of this tenant.
    const init = await dwr('getInitialJobSearchData', cfg.searchPage, [
      { filterOnly: 'Y', jobAlertId: '', returnToList: '', browserTimeZone: 'UTC' },
    ]);
    const filters = init.filter((o) => o && !Array.isArray(o) && typeof o.fieldName === 'string' && 'fieldType' in o);
    const languages = init
      .filter((o) => o && !Array.isArray(o) && typeof o.value === 'string' && LOCALE_RE.test(o.value))
      .map((o) => o.value);
    if (!filters.length || !languages.length) {
      throw new Error('successfactors-classic: no filter fields or keyword languages in the initial data (protocol changed?)');
    }
    const searchScope = init.find((o) => o && !Array.isArray(o) && typeof o.searchScope === 'string')?.searchScope || '1';
    const picklists = filters.filter((f) => f.fieldType === 'picklist');

    // No criteria but every language: the board's whole inventory.
    await dwr('updateUserSelectedValues', cfg.searchPage, [
      {
        daysPostedWithin: null, exactMatch: false, fullySelectedPicklists: {},
        jobReqId: null, keyword: '', keywordLanguageSelectedValues: languages, objSelectedValues: {},
        picklistSelectedValues: Object.fromEntries(picklists.map((f) => [f.fieldName, []])),
        radialField: null, searchScope,
      },
      null,
    ]);

    const summaryPage = `/career?company=${encodeURIComponent(cfg.company)}&career%5fns=job%5flisting%5fsummary&navBarLevel=JOB%5fSEARCH&_s.crb=${encodeURIComponent(key)}`;
    const maxPages = resolveMaxPages(entry);
    const pagesToFetch = Math.min(maxPages, probing ? ctxMaxPages : Infinity);

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();
    const seenKeys = new Set(); // raw rows of earlier pages, as the source returned them
    let total = null;
    let stopReason = 'complete';
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let parsed;
      try {
        const reply = await dwr('search', summaryPage, [
          {
            pagination: {
              currentPage: page, endRow: page * PAGE_SIZE, increaseCandSummaryPagination: false,
              pageSize: String(PAGE_SIZE), startRow: (page - 1) * PAGE_SIZE + 1, totalCount: total ?? 0,
            },
            sortByColumn: 'JOB_POSTING_DATE', sortOrder: 'DESC',
          },
        ]);
        parsed = parseSearchReply(reply, cfg, entry.name, lang);
      } catch (err) {
        // The first page, and any page of a health probe, fails loud and unwrapped.
        if (page === 1 || probing) throw err;
        console.error(`⚠️  successfactors-classic: ${entry.name} stopped at page ${page} (${/** @type {Error} */ (err).message}), keeping ${jobs.length} postings`);
        stopReason = 'fetch-error';
        break;
      }
      total = parsed.total ?? total;
      for (const job of parsed.jobs) {
        if (seen.has(job.listingIdentity.posting_id)) continue;
        seen.add(job.listingIdentity.posting_id);
        jobs.push(job);
      }
      // A later page made only of rows an earlier page already returned. The source answers a
      // page past its end with the board's rows again (checked live), so a board of an exact
      // multiple of PAGE_SIZE ends this way: complete when the counted total says every row was
      // already read. Otherwise the server ignored the page number, the rest of the board is out
      // of reach and the read is partial. Judged on the rows as the source sent them, before
      // any is dropped. This stop and the cap below are the only ones that read the count, and
      // only for the label: a stale count can mislabel the stop, never cut a walk short.
      const repeated = page > 1 && parsed.keys.length > 0 && parsed.keys.every((k) => seenKeys.has(k));
      if (repeated) {
        if (total !== null && seenKeys.size >= total) break;
        console.error(`⚠️  successfactors-classic: ${entry.name} ignored the page number (page ${page} repeated earlier postings), keeping ${jobs.length} postings`);
        stopReason = 'page-ignored';
        break;
      }
      for (const k of parsed.keys) seenKeys.add(k);
      // Rows the source returned, before malformed ones were dropped: a short or empty page is
      // the board's own end. A full page whose rows all failed normalization is not: the next
      // page may hold valid ones. The counted total can be stale, so it never ends the walk
      // early; it only settles a full page at the cap, where no further request is allowed.
      if (parsed.rawCount < PAGE_SIZE) break;
      if (page === pagesToFetch && !probing && !(total !== null && seenKeys.size >= total)) stopReason = 'cap';
    }
    if (total !== null && total > 0 && jobs.length === 0) {
      throw new Error('successfactors-classic: postings counted but none read (protocol changed?)');
    }
    if (stopReason === 'cap') {
      console.error(`⚠️  successfactors-classic: ${entry.name} stopped at max_pages=${maxPages} with ${jobs.length} postings, more were available — raise max_pages on this entry`);
    }
    if (stopReason !== 'complete') markTruncated(jobs, stopReason === 'cap' ? 'page-cap' : stopReason, { fetched: jobs.length, ...(total !== null ? { total } : {}) });
    return jobs;
  },
};
