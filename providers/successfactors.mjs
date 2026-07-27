// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SAP SuccessFactors provider — Recruiting Marketing (RMK, ex-jobs2web) career
// sites (Career Site Builder's branded job boards). These are the portals big
// German industrials run at their own domains (jobs.zf.com, jobs.schaeffler.com,
// jobs.hensoldt.net, jobs.sap.com, …) — all served by the same SF RMK backend.
//
// The RMK backend exposes a public, no-auth job-list fragment endpoint:
//   GET {origin}/tile-search-results/?startrow={N}
// It returns an HTML fragment (not JSON) of <li class="job-tile job-id-{id}">
// blocks, each carrying data-url (job path), the title link, and — when the
// tenant configures it — a rendered city field. We parse those out; the scanner
// contract only needs {title, url, company, location, postedAt}.
//
// Pagination: startrow is a plain row offset, and page size is tenant-specific
// (Schaeffler serves 100/page, most others 25). We never assume a page size —
// each loop advances startrow by the number of tiles actually returned, and a
// per-id dedup set guards against overlap or a server that ignores the offset.
//
// Detection: branded RMK hosts (jobs.zf.com) contain no "successfactors" string,
// so detect() only auto-claims literal *.successfactors.eu/.com and jobs2web
// URLs. The branded portals are wired up with an explicit `provider:
// successfactors` in portals.yml (which bypasses detect()); `api:` may override
// careers_url when the public careers_url isn't the RMK origin.
//
// RMK carries no posting date in the list fragment, so postedAt is always
// omitted (consumers treat an absent date as "unknown", never as stale).
//
// ── CSB (Career Site Builder) variant ────────────────────────────────────────
// Newer SF tenants run the Career Site Builder "unified" search (jobs2web's
// searchResultsUnify.js). Their /tile-search-results/ endpoint returns only a
// 16-byte empty <!DOCTYPE html> shell — the jobs are loaded client-side from a
// JSON API instead:
//   POST {origin}/services/recruiting/v1/jobs
//   Content-Type: application/json
//   {"keywords":"","locale":"de_DE","location":"","pageNumber":0,"sortBy":"recent"}
//   → {"jobSearchResult":[{"response":{id,unifiedStandardTitle,unifiedUrlTitle,
//        jobLocationShort:[…],unifiedStandardStart:"6/18/26",…}}], "totalJobs":N}
// 10 results/page; pageNumber is 0-based. The detail URL the site itself builds
// (from searchResultsUnify.js) is {origin}/job/{urlTitle}/{id}-{locale}.
//
// CRITICAL — locale gating: the API only returns a posting under a locale it was
// published in (each record carries `supportedLocales`). The same tenant reports
// wildly different totals per locale — MAN: de_DE=601 but en_US=8; TRATON: en_US
// only; Hexagon: en_GB only (de_DE/en_US both 0). A hardcoded locale would miss
// entire tenants, so we DISCOVER each tenant's advertised locales from the
// language switcher on {origin}/search/ (the `locale=xx_XX` links), query every
// one, and dedup by job id. CSB carries a real posting date, so postedAt is set.
//
// Strategy selection: `sfVariant: csb` on the portal entry forces CSB directly;
// otherwise the RMK tile path runs first and, only if it yields zero postings
// (the empty-shell signature), we fall back to CSB automatically.

const MAX_PAGES = 40; // safety cap on request count (RMK tile pagination)
const MAX_JOBS = 1000; // cap total postings pulled per site (both strategies)

// CSB knobs.
const CSB_PAGE_SIZE = 10; // fixed by the /services/recruiting/v1/jobs API
const CSB_MAX_PAGES_PER_LOCALE = 100; // safety cap per locale (100*10 = 1000 postings)
const CSB_MAX_LOCALES = 16; // guard against a tenant advertising an absurd locale list
// Locales tried when /search/ discovery yields nothing (fetch failed / markup
// changed). de_DE + en_US cover the DACH targets this provider is aimed at.
const CSB_DEFAULT_LOCALES = ['de_DE', 'en_US'];
// Query order: the DACH-relevant, usually job-rich locales first, so a bounded
// probe (max_pages:1) hits real postings early and dedup keeps a sensible URL
// locale for jobs published in several languages.
const CSB_LOCALE_PRIORITY = ['de_DE', 'en_US', 'en_GB', 'en_EN'];

/** @param {import('./_types.js').PortalEntry} entry */
export function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // Preserve a brand/tenant path prefix when the configured URL carries one —
  // some holding companies run several acquired brands off one shared RMK
  // instance, disambiguated by a path segment instead of a separate domain
  // (e.g. careers.nemetschek.com/Bluebeam/ vs. .../Vectorworks/). Strip a
  // trailing known-endpoint segment — /search/ (the page tenants commonly
  // configure as careers_url), or one of the API paths this module itself
  // builds below (/tile-search-results/, /services/recruiting/v1/jobs), in
  // case an `api:` override points straight at one — plus any trailing
  // slash, so all of those collapse to the same brand-scoped base instead of
  // doubling the endpoint segment onto itself. Single-domain tenants (the
  // common case) have an empty pathname, so base === origin unchanged.
  const path = u.pathname
    .replace(/\/(?:search|tile-search-results|services\/recruiting\/v1\/jobs)\/?$/i, '')
    .replace(/\/+$/, '');
  const base = u.origin + path;
  return {
    origin: u.origin,
    base,
    tileApi: `${base}/tile-search-results/`,
    // jobBase stays origin-only: RMK tile data-url paths for a brand-scoped
    // tenant already carry the brand segment (confirmed against Nemetschek's
    // /Bluebeam/tile-search-results/ output), so prefixing base here would
    // double it up.
    jobBase: u.origin,
    jobsApi: `${base}/services/recruiting/v1/jobs`,
    searchPage: `${base}/search/`,
  };
}

// Minimal HTML entity decoder — titles carry named (&amp;) and numeric
// (&#252; / &#xfc;) entities. We only need the handful that show up in job
// titles; anything else is left as-is.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// RMK job paths encode the city as the leading slug segment:
//   /job/{City-Words}-{Title-Words}-{reqCode}/{id}/
// When the tenant doesn't render a dedicated city field we recover the city by
// stripping the title (and trailing code) off the front slug. We anchor on the
// first two title words — a prefix the slug always reproduces verbatim, unlike
// the title's tail where punctuation like "(m/w/d)" gets mangled.
/** @param {string} dataUrl @param {string} title */
export function cityFromSlug(dataUrl, title) {
  let path;
  try {
    path = decodeURIComponent(dataUrl);
  } catch {
    path = dataUrl;
  }
  const m = path.match(/\/job\/([^/]+)\//);
  if (!m) return '';
  const slug = m[1].toLowerCase();
  const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words || !words.length) return '';
  // Anchor on the first two title words, but allow ANY run of non-alphanumerics
  // between them — in the slug those words may be joined by "-", "-amp-" (a
  // decoded "&"), or several hyphens, none of which survive the title's word
  // split. A rigid "word-word" anchor would miss "Program & Release" → "program-&amp;-release".
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let anchorRe;
  try {
    anchorRe = new RegExp(words.slice(0, 2).map(esc).join('[^\\p{L}\\p{N}]+'), 'u');
  } catch {
    return '';
  }
  const hit = slug.match(anchorRe);
  if (!hit || hit.index === undefined || hit.index <= 0) return '';
  return slug
    .slice(0, hit.index)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Parse one page fragment into raw {id, title, url, city} records.
// Each posting renders three responsive copies (desktop/tablet/mobile) inside
// one <li>; a single <li> per id means the top-level dedup already collapses
// them, and within a block the first match of each field wins.
/** @param {string} htmlText @param {string} jobBase */
export function parseTiles(htmlText, jobBase) {
  const out = [];
  const tileRe = /<li class="job-tile job-id-(\d+)\b[\s\S]*?<\/li>/g;
  let t;
  while ((t = tileRe.exec(htmlText)) !== null) {
    const id = t[1];
    const block = t[0];
    const urlM = block.match(/data-url="([^"]+)"/);
    if (!urlM) continue;
    const titleM = block.match(/class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const title = titleM ? clean(titleM[1]) : '';
    if (!title) continue;
    // data-url is an HTML attribute, so a literal "&" in the path arrives as
    // &amp;. Decode entities (but not percent-encoding — %28 etc. stays) before
    // both URL building and slug parsing, so the "amp" of &amp; can't leak into
    // the recovered city.
    const path = decodeEntities(urlM[1]);
    // Anchor on id="…-section-city-value"> — the value div. The sibling label
    // span references the same id via aria-describedby, so a looser match would
    // swallow the "City" label text too.
    const cityM = block.match(/id="[^"]*-section-city-value">([\s\S]*?)<\/div>/);
    const city = cityM ? clean(cityM[1]) : cityFromSlug(path, title);
    const url = /^https?:\/\//i.test(path) ? path : jobBase + (path.startsWith('/') ? path : '/' + path);
    out.push({ id, title, url, location: city });
  }
  return out;
}

// ── CSB helpers ──────────────────────────────────────────────────────────────

// Pull the tenant's advertised locales from the {origin}/search/ page. The CSB
// language switcher renders them as `/search/?q=&startrow=0&locale=xx_XX` links
// (HTML-escaped, so `&amp;` — the regex just anchors on `locale=`). Returns a
// de-duped, priority-ordered list; empty when the markup carries none.
/** @param {string} html */
export function extractLocales(html) {
  const found = new Set();
  const re = /locale=([a-z]{2}_[A-Z]{2})\b/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[1]);
  const all = [...found];
  const prio = (loc) => {
    const i = CSB_LOCALE_PRIORITY.indexOf(loc);
    return i === -1 ? CSB_LOCALE_PRIORITY.length : i;
  };
  all.sort((a, b) => prio(a) - prio(b) || a.localeCompare(b));
  return all.slice(0, CSB_MAX_LOCALES);
}

// CSB posting dates are rendered in the query locale's short format: US tenants
// send M/D/YY with slashes ("6/18/26"), European (de_DE) tenants send D.M.YY
// with dots ("20.11.23"). Infer the field order from the separator, treat a
// 2-digit year as 20YY, and return epoch ms. Anything unexpected yields
// undefined so a consumer sees "unknown date" rather than a bogus timestamp.
/** @param {unknown} raw */
export function parseCsbDate(raw) {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  let a, b, year;
  let slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  let dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (slash) {
    // M/D/Y
    [, a, b, year] = slash;
  } else if (dot) {
    // D.M.Y — swap to month/day
    [, b, a, year] = dot;
  } else {
    return undefined;
  }
  const month = Number(a);
  const day = Number(b);
  let y = Number(year);
  if (y < 100) y += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ms = Date.UTC(y, month - 1, day);
  return Number.isFinite(ms) ? ms : undefined;
}

// jobLocationShort is an array of strings like "Karlovy Vary, CZE, 36004<br/>"
// (one per work location). Strip the trailing <br/> and any other markup, drop
// empties, and join multiple locations with " / ".
/** @param {unknown} raw */
export function cleanCsbLocation(raw) {
  const parts = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const cleaned = [];
  for (const p of parts) {
    const s = clean(String(p));
    if (s && !cleaned.includes(s)) cleaned.push(s);
  }
  return cleaned.join(' / ');
}

// Map one CSB jobs-API response to raw {id, title, url, location, postedAt}.
// Records nest the useful fields under `.response`; a record without an id or a
// title is skipped (can't build a stable dedup key or a meaningful listing).
/** @param {any} json @param {{origin:string, base?:string}} cfg @param {string} locale */
export function parseCsbJobs(json, cfg, locale) {
  const list = Array.isArray(json?.jobSearchResult) ? json.jobSearchResult : [];
  const out = [];
  for (const item of list) {
    const r = item?.response;
    if (!r) continue;
    const id = r.id != null ? String(r.id) : '';
    const title = clean(String(r.unifiedStandardTitle || r.jobTitle || ''));
    if (!id || !title) continue;
    // The site builds the slug from urlTitle/unifiedUrlTitle. The slug is purely
    // cosmetic — the server keys only on the {id}-{locale} tail (a stub slug
    // resolves the same posting) — but tenants render it inconsistently: some
    // percent-encode it ("Oper%C3%A1tor-…"), others leave HTML entities in
    // ("Mergers-&amp;-Acquisitions"). Decode entities, then drop the URL-
    // structural chars (& ? #) a raw entity would otherwise inject into the
    // path, leaving any existing %XX escapes untouched.
    const slug = decodeEntities(String(r.unifiedUrlTitle || r.urlTitle || 'job'))
      .replace(/[?#&]+/g, '-')
      .replace(/-{2,}/g, '-');
    const url = `${cfg.base || cfg.origin}/job/${slug}/${id}-${locale}`;
    out.push({
      id,
      title,
      url,
      location: cleanCsbLocation(r.jobLocationShort),
      postedAt: parseCsbDate(r.unifiedStandardStart),
    });
  }
  return out;
}

/** Resolve the per-locale page cap: positive integer `max_pages`, else default. */
function resolveCsbMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, CSB_MAX_PAGES_PER_LOCALE);
  return CSB_MAX_PAGES_PER_LOCALE;
}

// CSB strategy: discover locales, paginate the JSON jobs API per locale, dedup
// by id across locales+pages. `total` from the first page bounds pagination;
// an empty/short page also stops the loop.
/** @param {import('./_types.js').PortalEntry} entry @param {any} cfg @param {import('./_types.js').Context} ctx */
async function fetchCsb(entry, cfg, ctx) {
  let locales = CSB_DEFAULT_LOCALES;
  try {
    const html = await ctx.fetchText(cfg.searchPage, { redirect: 'error', headers: { accept: 'text/html' } });
    const discovered = extractLocales(html);
    if (discovered.length) locales = discovered;
  } catch {
    // Discovery is best-effort; fall back to the default locale set.
  }

  const maxPages = resolveCsbMaxPages(entry);
  const jobs = [];
  const seen = new Set();

  for (const locale of locales) {
    if (jobs.length >= MAX_JOBS) break;
    let total = null;
    for (let page = 0; page < maxPages; page++) {
      let json;
      try {
        json = await ctx.fetchJson(cfg.jobsApi, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ keywords: '', locale, location: '', pageNumber: page, sortBy: 'recent' }),
        });
      } catch {
        break; // this locale failed (e.g. 307 legacy redirect) — try the next
      }
      if (total === null) {
        total = typeof json?.totalJobs === 'number' ? json.totalJobs : null;
      }
      // Page-fullness checks below use the raw response count, not rows.length:
      // parseCsbJobs drops id/title-less records, and a full API page with a
      // few dropped records would otherwise look "short" and stop pagination
      // before reaching later pages that still hold valid jobs.
      const rawCount = Array.isArray(json?.jobSearchResult) ? json.jobSearchResult.length : 0;
      if (rawCount === 0) break;
      const rows = parseCsbJobs(json, cfg, locale);

      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const job = { title: row.title, url: row.url, company: entry.name, location: row.location };
        if (typeof row.postedAt === 'number') job.postedAt = row.postedAt;
        jobs.push(job);
        if (jobs.length >= MAX_JOBS) break;
      }
      if (jobs.length >= MAX_JOBS) break;
      // Stop once we've covered the reported total, or on a short page.
      if (total !== null && (page + 1) * CSB_PAGE_SIZE >= total) break;
      if (rawCount < CSB_PAGE_SIZE) break;
    }
  }
  return jobs;
}

// RMK strategy: the original /tile-search-results/ HTML-fragment scraper.
/** @param {import('./_types.js').PortalEntry} entry @param {any} cfg @param {import('./_types.js').Context} ctx */
async function fetchRmk(entry, cfg, ctx) {
  const jobs = [];
  const seen = new Set();
  let startrow = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const htmlText = await ctx.fetchText(`${cfg.tileApi}?startrow=${startrow}`, {
      redirect: 'error',
      headers: { accept: 'text/html' },
    });
    const tiles = parseTiles(htmlText, cfg.jobBase);
    if (tiles.length === 0) break;

    let fresh = 0;
    for (const tile of tiles) {
      if (seen.has(tile.id)) continue;
      seen.add(tile.id);
      fresh++;
      jobs.push({
        title: tile.title,
        url: tile.url,
        company: entry.name,
        location: tile.location,
      });
    }
    // No new ids this page → server ignored the offset (or we've looped). Stop.
    if (fresh === 0) break;
    if (jobs.length >= MAX_JOBS) break;
    startrow += tiles.length;
  }
  // The cap is checked between pages, so the last page can overshoot it.
  return jobs.slice(0, MAX_JOBS);
}

/** @type {Provider} */
export default {
  id: 'successfactors',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (/successfactors\.(eu|com)|jobs2web\.com/i.test(url)) return { url };
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`successfactors: cannot resolve origin for ${entry.name}`);

    // Explicit opt-in goes straight to CSB. RMK tenants (the majority) run the
    // tile scraper; only when it comes back empty — the CSB empty-shell
    // signature — do we auto-fall back to the JSON API, so an unflagged CSB
    // tenant still works and a genuinely-empty RMK board costs one extra probe.
    if (String(entry.sfVariant || '').toLowerCase() === 'csb') {
      return fetchCsb(entry, cfg, ctx);
    }
    const rmkJobs = await fetchRmk(entry, cfg, ctx);
    if (rmkJobs.length > 0) return rmkJobs;
    return fetchCsb(entry, cfg, ctx);
  },
};
