// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, isRetryableError, sleep } from './_http.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// Avature provider — parses the public Avature career-site job list.
// Auto-detects from a careers_url on `*.avature.net`; a branded custom domain
// that proxies Avature needs an explicit `provider: avature` + `api:` pointing
// at the Avature origin (or its /careers/SearchJobs URL).
//
//   GET {origin}/careers/SearchJobs?jobOffset=N
//
// returns a server-rendered page of <article class="article--result"> blocks.
// Some tenants have no SearchJobs at all and list postings on per-country pages
// (e.g. /en_US/careers/JobOpeningsSpain, rows are <div class="article
// article--result">): such a URL is honoured as the list path, the same way a
// facet-filtered SearchJobs URL is (the user's choice of view).
// Avature hard-caps the page at 6 results (a jobRecordsPerPage override is
// ignored), and paginates via jobOffset in steps of 6 — so this is request-
// heavy for large boards; max_pages (default 50 → ~300 postings) bounds it and
// can be raised per entry.
//
// Pagination parameter name is `jobOffset` on classic tenants, but some branded
// tenants ignore it and page via a bare `offset` instead (e.g. jobs.siemens.com:
// `?jobOffset=6` returns page 1 unchanged, `?offset=6` advances). This is
// self-healing: we start with `jobOffset`, and if the first paginated page comes
// back identical to page 0 (every id already seen → the param is inert), we
// retry that page once with `offset` and adopt whichever key actually advances.
// So a new branded tenant needs no configuration. An entry can still pin the key
// explicitly via `offset_param` (disables the auto-switch) as an escape hatch.
//
// Location isn't rendered in every tenant's list (the subtitle is Job ID /
// hire-type / posted-date); we extract it when a marker is present and leave it
// empty otherwise. postedAt comes from the "Posted DD-Mon-YYYY" subtitle.
//
// `api:`'s query string may carry the entry's own filter facets (picked in
// the tenant's search UI — country, field of work, experience level, …); they
// are preserved on every paginated request, not just the first, narrowing a
// huge global board to a cheap-to-walk one. A first page with posting-shaped
// `JobDetail/` links but zero parsed articles throws (a markup change), never
// silently reads as an empty board — see `assertParsedSomething`.
//
// A page with no posting rows is read as an empty board or as the end of the
// walk, so it must be an Avature listing page before it is trusted as either:
// a challenge, login or error page served with HTTP 200 carries no rows either
// and would otherwise return [] or a truncated board as if complete. Every
// real listing page seen on 2026-11-19 (Enel, Siemens, Macquarie, Deloitte
// USI, careers.avature.net, Booz Allen, Lenovo and Bloomberg), their
// no-results pages included, carries the `list-controls` toolbar, and
// Avature's own "Oops" error page (HTTP 200, served for an offset far past
// what a walk asks for) does not. A row-less page without the toolbar throws,
// on every page (the first, later ones, the self-heal retry and a
// verify-portals probe).

const PAGE_SIZE = 6; // Avature serves exactly 6 results per page
const DEFAULT_MAX_PAGES = 50; // ~300 postings; override via entry.max_pages
const HARD_MAX_PAGES = 200;
// Pause between successive page requests. Avature's 6-results-per-page cap makes
// large boards request-heavy (a 999+ board is ~170 pages); firing those with no
// gap risks the tenant's WAF rate-limiting the burst. Mirrors workday's
// INTER_PAGE_DELAY_MS — only boards that paginate past page 0 pay it.
const INTER_PAGE_DELAY_MS = 250;
// The default pagination key classic tenants honour.
const PRIMARY_OFFSET_PARAM = 'jobOffset';
// The bare key we self-heal to when the primary proves inert.
const FALLBACK_OFFSET_PARAM = 'offset';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Reserved keys the provider itself controls per page request. Stripped out
// of any facet query string on the entry so a stray same-named facet can
// never collide with (or be silently overwritten by) our own pagination key.
const RESERVED_PAGINATION_KEYS = new Set([PRIMARY_OFFSET_PARAM.toLowerCase(), FALLBACK_OFFSET_PARAM.toLowerCase()]);

/** @param {import('./_types.js').PortalEntry} entry */
function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // Honour an explicit list path: a SearchJobs path (branded tenants may prefix
  // a locale, e.g. /en_US/searchjobs/SearchJobs) or a per-country opening page
  // (/careers/JobOpeningsSpain, the only listing some tenants have). Anything
  // else defaults to the classic path.
  const searchPath = /\/(?:SearchJobs\b|JobOpenings[^/]*\/?$)/i.test(u.pathname)
    ? u.pathname.replace(/\/+$/, '')
    : '/careers/SearchJobs';
  // Carry over any facet/filter query params the entry pinned (e.g. Avature's
  // wizard-generated field-value facets, ?42386=[812132]&... for a country
  // filter) so a pre-narrowed board (fewer pages to walk) stays narrowed on
  // every paginated request, not just the first. Our own offset key is
  // applied per-request in fetch() and always wins over a same-named facet.
  const extraParams = new URLSearchParams(u.search);
  for (const key of [...extraParams.keys()]) {
    if (RESERVED_PAGINATION_KEYS.has(key.toLowerCase())) extraParams.delete(key);
  }
  return { searchUrl: `${u.origin}${searchPath}`, origin: u.origin, extraParams };
}

// The result-list toolbar (`<div class="list-controls ...">`, sort and pagination),
// rendered on every Avature listing page including one whose only card says
// "No jobs found". Matched as a class token in an attribute, not in CSS or script.
const LISTING_PAGE = /\sclass\s*=\s*(?:"[^"]*?|'[^']*?)(?<![\w-])list-controls(?![\w-])/i;

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*(>?)/g, (tag, close) => (close ? ' ' : tag))).replace(/\s+/g, ' ').trim();
}

// "Posted 02-May-2026" → epoch ms (UTC midnight). Undefined when absent/unparseable.
/** @param {string} block */
function parsePosted(block) {
  const m = block.match(/Posted\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return undefined;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return undefined;
  const ms = Date.UTC(Number(m[3]), mon, Number(m[1]));
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Posting id of an absolute JobDetail URL: `/JobDetail/<slug>/<id>` or
 * `/JobDetail/<id>` read from the path only, `?jobId=<id>` from the query only,
 * so an id inside another parameter (`returnUrl=/JobDetail/123`) is never taken.
 * @param {string} url
 * @returns {string|null}
 */
function postingId(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const pathM = u.pathname.match(/\/JobDetail\/[^/]*\/(\d+)/) || u.pathname.match(/\/JobDetail\/(\d+)\/?$/);
  if (pathM) return pathM[1];
  const q = u.searchParams.get('jobId');
  return /\/JobDetail\/?$/.test(u.pathname) && q && /^\d+$/.test(q) ? q : null;
}

// Best-effort location: some tenants tag it with a list-item-location span or a
// map-marker glyph; most (e.g. Synopsys) render none, so this returns ''.
/** @param {string} block */
function parseLocation(block) {
  const m =
    block.match(/list-item-location[^>]*>([\s\S]*?)<\/span>/i) ||
    block.match(/subtitle--location[^>]*>([\s\S]*?)<\/span>/i) ||
    block.match(/class="[^"]*\blocation\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|li)>/i) ||
    block.match(/glyphicon-map-marker[\s\S]{0,80}?>([^<]{2,60})</i) ||
    block.match(/icon-address[^>]*><\/span>([^<]{2,80})</i);
  return m ? clean(m[1]) : '';
}

/**
 * A first page with zero parsed articles is either a genuinely empty board
 * or a markup change breaking the `<article class="article article--result">`
 * selector — those must not look the same to a caller (the whole risk of
 * scraping is a silent-zero failure reading as "no jobs" instead of "the
 * parser broke"). Throws when the raw HTML still carries posting-shaped
 * `JobDetail/` links (the page has rows; the selector just isn't finding
 * them); returns silently for a page carrying neither — a genuinely empty
 * board. Mirrors `providers/itviec.mjs`'s `assertParsedSomething`; called on
 * the first page only (a later empty/short page is just the end of a real
 * board, not a parser regression).
 * @param {string} html
 * @param {string} url
 */
export function assertParsedSomething(html, url) {
  if (!/\/JobDetail[/?][^"'\s]+/i.test(String(html ?? ''))) return;
  throw new Error(
    `avature: ${url} still contains JobDetail links but no article could be parsed — the listing markup changed`,
  );
}

// Tenants vary the result class: Synopsys uses `article--result`, Siemens
// appends a position index (`article--result 1`). Accept any suffix.
// careers.avature.net renders `article--jobs` cards instead (seen 2026-09-28).
// Deloitte USI drops the leading `article` class: `<article class="article--result ">`.
// Enel's opening pages use `<div class="article article--result">` rows with no
// closing `</article>`, so a div row ends at its own matching `</div>` (nested
// divs counted) and never past the next row: the last row does not take in the
// page footer. A row whose markup never closes keeps the old boundary, the next
// row or the end of the page.
const CARD_START = /<(article|div) class="(?:article )?article--(?:result|jobs)\b[^"]*"/g;

/**
 * Index just past the `</div>` that closes a div card whose opening tag ends at `from`,
 * counting nested `<div` / `</div>` tags; null when the markup never closes it.
 * @param {string} text @param {number} from @returns {number | null}
 */
function divCardEnd(text, from) {
  const tag = /<div(?![A-Za-z0-9_-])|<[/]div[^>]*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return null;
}

/** @param {string} htmlText @returns {string[]} */
function splitCards(htmlText) {
  const text = String(htmlText ?? '');
  const starts = [...text.matchAll(CARD_START)];
  return starts.map((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    if (m[1] !== 'article') return text.slice(m.index, Math.min(end, divCardEnd(text, m.index + m[0].length) ?? end));
    const block = text.slice(m.index, end);
    const close = block.indexOf('</article>');
    return close === -1 ? block : block.slice(0, close + '</article>'.length);
  });
}

/**
 * Number of result cards on a page, before `parseArticles` drops any (no
 * JobDetail link, empty title). The short-page stop compares this count, not
 * the parsed one. Shares `ARTICLE_PATTERN` with `parseArticles`.
 * @param {string} htmlText
 */
export function countArticles(htmlText) {
  return splitCards(htmlText).length;
}

/** @param {string} htmlText @param {string} origin */
export function parseArticles(htmlText, origin) {
  const out = [];
  for (const block of splitCards(htmlText)) {
    // JobDetail path may or may not sit under /careers/ (branded tenants vary),
    // so anchor on JobDetail itself rather than a fixed prefix. Prefer the
    // `class="link"` title anchor (most tenants); fall back to any JobDetail
    // anchor for tenants (e.g. Rohde & Schwarz) whose title link carries no
    // class. Links are path-style `/JobDetail/<slug>/<id>` or query-style
    // `/JobDetail?jobId=<id>` (e.g. Macquarie). Share/mailto buttons url-encode
    // the path (%2FJobDetail%2F / %3F) so they never match and can't be
    // mistaken for the title. An `article--jobs` card's class="link" anchor is a
    // "View more" button, so its h3 header title anchor is tried first.
    const urlM =
      block.match(/article__header__text__title[^>]*>\s*<a[^>]*href="([^"]*\/JobDetail[/?][^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/<a[^>]*class="link"[^>]*href="([^"]*\/JobDetail[/?][^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/<a[^>]*href="([^"]*\/JobDetail[/?][^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!urlM) continue;
    const title = clean(urlM[2]);
    if (!title) continue;
    let url = decodeEntities(urlM[1]);
    if (!/^https?:\/\//i.test(url)) {
      // new URL resolves root-relative, path-relative and protocol-relative
      // (//host/...) hrefs the way a browser would; string concatenation would
      // turn the protocol-relative form into origin + "//host/...". A href it
      // cannot resolve is dropped rather than emitted as a broken URL.
      try {
        url = new URL(url, origin).href;
      } catch {
        continue;
      }
      // A href with its own scheme (javascript:, data:, mailto:) is absolute,
      // so new URL keeps it as it is: only http(s) is a job link.
      if (!/^https?:\/\//i.test(url)) continue;
    }
    const id = postingId(url);
    out.push({
      id: id ?? url,
      title,
      url,
      location: parseLocation(block),
      postedAt: parsePosted(block),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'avature',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    try {
      const host = new URL(url).host.toLowerCase();
      if (host === 'avature.net' || host.endsWith('.avature.net')) return { url };
    } catch {
      /* not absolute */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`avature: cannot resolve origin for ${entry.name}`);
    const maxPages = Math.min(
      HARD_MAX_PAGES,
      Number.isFinite(entry.max_pages) && entry.max_pages > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES,
    );

    // Pagination key. An explicit `offset_param` pins it (and disables the
    // auto-switch below); otherwise start with `jobOffset` and self-heal. A
    // non-string/empty override falls back to the default so a malformed entry
    // can't produce `?=N`.
    const pinned = typeof entry.offset_param === 'string' && entry.offset_param.trim();
    let offsetParam = pinned ? entry.offset_param.trim() : PRIMARY_OFFSET_PARAM;
    let canHeal = !pinned; // once the key is pinned, never auto-switch

    const jobs = [];
    const seen = new Set();

    // Exhaustion policy: a request that still fails transiently after
    // fetchTextWithRetry (429, 5xx, transport) on a page past the first keeps the
    // pages already collected, warns and tags the board partial, so one flaky
    // response does not drop the whole listing. Page 0 (nothing collected), a
    // non-transient failure (403, a challenge, a refused redirect, a 200 page
    // that is not an Avature listing page) and a verify-portals probe
    // (`ctx.maxPages`, whose request-budget error must stay unwrapped) all throw.
    // The "raise max_pages" advice is never given for it.
    const probing = Number(ctx.maxPages) > 0;
    let fetchError = null;
    const tolerates = (err, page) => {
      if (page === 0 || probing || err?.notListingPage || !isRetryableError(err)) return false;
      fetchError = err;
      return true;
    };

    const getPage = async (param, page) => {
      const usp = new URLSearchParams(cfg.extraParams);
      usp.set(param, String(page * PAGE_SIZE));
      const url = `${cfg.searchUrl}?${usp.toString()}`;
      const htmlText = await fetchTextWithRetry(ctx, url, {
        redirect: 'error',
        headers: { accept: 'text/html' },
      });
      const articles = parseArticles(htmlText, cfg.origin);
      // Rows prove a listing page; without any, the page must still be one.
      if (articles.length === 0 && !LISTING_PAGE.test(String(htmlText ?? ''))) {
        throw Object.assign(
          new Error(`avature: ${url} does not look like an Avature listing page (a challenge, login or error page?)`),
          { notListingPage: true },
        );
      }
      return { url, html: htmlText, articles, cards: countArticles(htmlText) };
    };
    // Absorb a page's articles, returning how many were not already seen.
    const absorb = (articles) => {
      let fresh = 0;
      for (const art of articles) {
        if (seen.has(art.id)) continue;
        seen.add(art.id);
        fresh++;
        jobs.push({
          title: art.title,
          url: art.url,
          company: entry.name,
          location: art.location,
          postedAt: art.postedAt,
        });
      }
      return fresh;
    };

    // A page is stalled when it has no cards (empty) or every parsed article
    // was already seen (the offset repeated a page). Zero fresh jobs alone is
    // not enough: a page of cards that parseArticles dropped is still progress.
    const stalled = (result, fresh) => result.cards === 0 || (fresh === 0 && result.articles.length > 0);

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let result;
      try {
        result = await getPage(offsetParam, page);
      } catch (err) {
        if (!tolerates(err, page)) throw err;
        break;
      }
      let fresh = absorb(result.articles);

      // Self-heal: the first paginated page didn't advance — either it repeated
      // page 0 (all-dup) or came back empty because the primary key is inert
      // (some tenants echo page 0 for an unknown param, others return nothing).
      // Retry this page once with the fallback key; if it advances, adopt it for
      // the remainder. Only on page 1 — inert pagination manifests immediately,
      // so a later non-advancing page is a genuine end-of-board, not a mismatch.
      // NOTE: the stall check must run before the empty-page break below,
      // or an inert key that returns an empty page 1 would exit without healing.
      if (stalled(result, fresh) && canHeal && page === 1) {
        canHeal = false;
        await sleep(INTER_PAGE_DELAY_MS, ctx);
        let altResult;
        try {
          altResult = await getPage(FALLBACK_OFFSET_PARAM, page);
        } catch (err) {
          if (!tolerates(err, page)) throw err;
          break;
        }
        const altFresh = absorb(altResult.articles);
        if (altFresh > 0) {
          offsetParam = FALLBACK_OFFSET_PARAM;
          result = altResult;
          fresh = altFresh;
        }
      }

      // Empty vs broken, first page only (see assertParsedSomething doc
      // comment) — a later empty/short page is just the end of a real board.
      if (page === 0 && result.articles.length === 0) assertParsedSomething(result.html, result.url);

      // Stop only on an empty or repeated page. A full page whose links were all
      // dropped (non-http scheme, no title) still advanced, so the walk goes on.
      if (stalled(result, fresh)) break; // empty page / looped / offset ignored / last page
      if (result.cards < PAGE_SIZE) break; // last page (raw card count, not the parsed one)
    }
    if (fetchError) {
      console.error(`⚠️  avature: ${entry.name} stopped after a fetch error (${fetchError.message}); kept ${jobs.length} postings`);
      markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    }
    return jobs;
  },
};
