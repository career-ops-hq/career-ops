// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Avature provider — parses the public Avature career-site job list.
// Auto-detects from a careers_url on `*.avature.net`; a branded custom domain
// that proxies Avature needs an explicit `provider: avature` + `api:` pointing
// at the Avature origin (or its /careers/SearchJobs URL).
//
//   GET {origin}/careers/SearchJobs?jobOffset=N
//
// returns a server-rendered page of <article class="article--result"> blocks.
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

const PAGE_SIZE = 6; // Avature serves exactly 6 results per page
const DEFAULT_MAX_PAGES = 50; // ~300 postings; override via entry.max_pages
const HARD_MAX_PAGES = 200;
// Pause between successive page requests. Avature's 6-results-per-page cap makes
// large boards request-heavy (a 999+ board is ~170 pages); firing those with no
// gap risks the tenant's WAF rate-limiting the burst. Mirrors workday's
// INTER_PAGE_DELAY_MS — only boards that paginate past page 0 pay it.
const INTER_PAGE_DELAY_MS = 150;
// The bare key we self-heal to when the primary (`jobOffset`) proves inert.
const FALLBACK_OFFSET_PARAM = 'offset';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

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
  // Honour an explicit SearchJobs path (branded tenants may prefix a locale,
  // e.g. /en_US/searchjobs/SearchJobs); otherwise default to the classic path.
  const searchPath = /\/SearchJobs\b/i.test(u.pathname) ? u.pathname.replace(/\/+$/, '') : '/careers/SearchJobs';
  return { searchUrl: `${u.origin}${searchPath}`, origin: u.origin };
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#8226': '•' };
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
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

// Best-effort location: some tenants tag it with a list-item-location span or a
// map-marker glyph; most (e.g. Synopsys) render none, so this returns ''.
/** @param {string} block */
function parseLocation(block) {
  const m =
    block.match(/list-item-location[^>]*>([\s\S]*?)<\/span>/i) ||
    block.match(/class="[^"]*\blocation\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|li)>/i) ||
    block.match(/glyphicon-map-marker[\s\S]{0,80}?>([^<]{2,60})</i);
  return m ? clean(m[1]) : '';
}

/** @param {string} htmlText @param {string} origin */
export function parseArticles(htmlText, origin) {
  const out = [];
  // Tenants vary the result class: Synopsys uses `article--result`, Siemens
  // appends a position index (`article--result 1`). Accept any suffix.
  const re = /<article class="article article--result[^"]*"[\s\S]*?<\/article>/g;
  let a;
  while ((a = re.exec(htmlText)) !== null) {
    const block = a[0];
    // JobDetail path may or may not sit under /careers/ (branded tenants vary),
    // so anchor on JobDetail/ itself rather than a fixed prefix. Prefer the
    // `class="link"` title anchor (most tenants); fall back to any JobDetail
    // anchor for tenants (e.g. Rohde & Schwarz) whose title link carries no
    // class. Share/mailto buttons url-encode the path (%2FJobDetail%2F) so they
    // never match the literal `/JobDetail/` and can't be mistaken for the title.
    const urlM =
      block.match(/<a[^>]*class="link"[^>]*href="([^"]*\/JobDetail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/<a[^>]*href="([^"]*\/JobDetail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!urlM) continue;
    const title = clean(urlM[2]);
    if (!title) continue;
    let url = decodeEntities(urlM[1]);
    if (!/^https?:\/\//i.test(url)) url = origin + (url.startsWith('/') ? url : '/' + url);
    const idM = url.match(/\/JobDetail\/[^/]*\/(\d+)/);
    out.push({
      id: idM ? idM[1] : url,
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
    let offsetParam = pinned ? entry.offset_param.trim() : 'jobOffset';
    let canHeal = !pinned; // once the key is pinned, never auto-switch

    const jobs = [];
    const seen = new Set();
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    const getPage = async (param, page) => {
      const htmlText = await ctx.fetchText(`${cfg.searchUrl}?${param}=${page * PAGE_SIZE}`, {
        redirect: 'error',
        headers: { accept: 'text/html' },
      });
      return parseArticles(htmlText, cfg.origin);
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

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS);
      let articles = await getPage(offsetParam, page);
      let fresh = absorb(articles);

      // Self-heal: the first paginated page didn't advance — either it repeated
      // page 0 (all-dup) or came back empty because the primary key is inert
      // (some tenants echo page 0 for an unknown param, others return nothing).
      // Retry this page once with the fallback key; if it advances, adopt it for
      // the remainder. Only on page 1 — inert pagination manifests immediately,
      // so a later non-advancing page is a genuine end-of-board, not a mismatch.
      // NOTE: fresh === 0 must be evaluated before the empty-page break below,
      // or an inert key that returns an empty page 1 would exit without healing.
      if (fresh === 0 && canHeal && page === 1) {
        canHeal = false;
        await sleep(INTER_PAGE_DELAY_MS);
        const altArticles = await getPage(FALLBACK_OFFSET_PARAM, page);
        const altFresh = absorb(altArticles);
        if (altFresh > 0) {
          offsetParam = FALLBACK_OFFSET_PARAM;
          articles = altArticles;
          fresh = altFresh;
        }
      }

      if (fresh === 0) break; // empty page / looped / offset ignored / last page
      if (articles.length < PAGE_SIZE) break; // last page
    }
    return jobs;
  },
};
