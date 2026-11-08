// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';
import { robotsAllows } from '../robots-check.mjs';

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

const MAX_PAGES = 40; // default cap on request count (RMK tile pagination)
const MAX_JOBS = 1000; // default cap on total postings pulled per site (both strategies)
// Opt-in ceilings. An entry may raise the defaults with `max_pages` / `max_jobs`
// up to these bounds; without either key the defaults above apply unchanged.
// Raising is also gated on the host's robots.txt (see allowRaise).
const RMK_MAX_PAGES_CEILING = 400;
const MAX_JOBS_CEILING = 10000;
// RMK pages are fetched as ?startrow=N, so the robots gate checks a paged URL (a
// rule on the query string would not show on the bare path).
const RMK_GATE_STARTROW = 25;

// CSB knobs.
const CSB_PAGE_SIZE = 10; // fixed by the /services/recruiting/v1/jobs API
const CSB_MAX_PAGES_PER_LOCALE = 100; // default cap per locale (100*10 = 1000 postings)
const CSB_MAX_PAGES_CEILING = 500; // opt-in ceiling per locale via `max_pages`
const CSB_MAX_LOCALES = 16; // guard against a tenant advertising an absurd locale list
// The API's own default sort ("recent", which the site itself sends) is not a
// stable order: each page request reshuffles ties, so offset paging returned
// only ~400 distinct ids of BMW's 521 per pass. "date" is nearly stable; a
// second sweep picks up the few same-day ties it still shuffles across pages.
const CSB_SORT = 'date';
const CSB_SWEEPS = 2;
// Pages per locale fetched in parallel once page 0 has reported totalJobs. Each
// call returns only 10 postings, so a 500-job tenant was ~50 calls in a row.
const CSB_PAGE_CONCURRENCY = 6;
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
  //
  // A saved-search "category" page, /go/<Category-Name>/<numericId>/ (with an
  // optional /<offset>/ once it is paginated, /go/All-Jobs/9170201/25/), is the
  // URL people copy from a careers page. It is not a brand prefix: tacked in
  // front of /tile-search-results/ it answers 200 with a full page and zero
  // tiles, which reads as a healthy empty board. Strip it so the tile endpoint
  // resolves to the tenant root; a brand segment in FRONT of /go/ survives
  // (/Bluebeam/go/X/123/ -> /Bluebeam).
  const path = u.pathname
    .replace(/\/go\/[^/]+\/\d+(?:\/\d+)?\/?$/i, '')
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

// CSB posting dates are rendered in the query locale's short format: en_US
// sends M/D/YY ("6/18/26"), de_DE D.M.YY ("20.11.23"), fr_FR and pt_BR
// D/M/YYYY ("05/10/2026"), hu_HU "2025. 07. 03.". Slashes are month-first only
// for the US locales; with no locale they stay month-first as before. A 2-digit
// year is 20YY. Anything unexpected yields undefined so a consumer sees
// "unknown date" rather than a bogus timestamp.
const CSB_MONTH_FIRST_LOCALES = new Set(['en_US', 'es_US']);

/** @param {unknown} raw @param {string} [locale] */
export function parseCsbDate(raw, locale) {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  let month, day, year;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  const yearFirst = s.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
  if (slash) {
    [, month, day, year] = slash;
    if (locale && !CSB_MONTH_FIRST_LOCALES.has(locale)) [month, day] = [day, month];
  } else if (dot) {
    [, day, month, year] = dot;
  } else if (yearFirst) {
    [, year, month, day] = yearFirst;
  } else {
    return undefined;
  }
  const m = Number(month);
  const d = Number(day);
  let y = Number(year);
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const ms = Date.UTC(y, m - 1, d);
  return new Date(ms).getUTCDate() === d ? ms : undefined;
}

// jobLocationShort is an array of strings like "Karlovy Vary, CZE, 36004<br/>"
// (one per work location). Strip the trailing <br/> and any other markup, drop
// empties, and join multiple locations with " / ".
//
// The jobs API also appends a comma after the last field ("Bend, OR, USA, ").
// clean() is shared with titles, which may legitimately end in a comma, so
// the extra comma comes off here only. Interior commas and a postal code stay.
/** @param {unknown} raw */
export function cleanCsbLocation(raw) {
  const parts = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const cleaned = [];
  for (const p of parts) {
    const s = clean(String(p)).replace(/,+$/, '').trim();
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
      postedAt: parseCsbDate(r.unifiedStandardStart, locale),
    });
  }
  return out;
}

/** Positive integer config value, else null. */
function posInt(v) {
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Resolve the caps for one strategy. `raised` is true when the entry asks for
 * more than the defaults — the only case that adds request volume, and so the
 * only case gated on robots.txt. A `max_pages` below the CSB default still
 * lowers the per-locale cap as before; on RMK it is only honored upward.
 * @param {any} entry @param {'rmk'|'csb'} kind
 */
export function resolveLimits(entry, kind) {
  const mp = posInt(entry?.max_pages);
  const mj = posInt(entry?.max_jobs);
  const defPages = kind === 'csb' ? CSB_MAX_PAGES_PER_LOCALE : MAX_PAGES;
  const ceiling = kind === 'csb' ? CSB_MAX_PAGES_CEILING : RMK_MAX_PAGES_CEILING;
  let maxPages = defPages;
  if (mp !== null) maxPages = kind === 'csb' ? Math.min(mp, ceiling) : Math.max(defPages, Math.min(mp, ceiling));
  const maxJobs = mj !== null ? Math.min(mj, MAX_JOBS_CEILING) : MAX_JOBS;
  return { maxPages, maxJobs, raised: maxPages > defPages || maxJobs > MAX_JOBS };
}

// Raising a cap is extra crawling, so it needs the host's robots.txt to permit
// the endpoint being paged. A Disallow (or an unreadable robots.txt: the gate
// fails closed) keeps the defaults and says so.
/** @param {any} entry @param {'rmk'|'csb'} kind @param {string} url @param {any} ctx */
async function limitsFor(entry, kind, url, ctx) {
  const limits = resolveLimits(entry, kind);
  if (!limits.raised) return limits;
  const gate = ctx?.robotsGate || robotsAllows;
  let verdict;
  try {
    verdict = await gate(url);
  } catch (err) {
    verdict = { allowed: false, reason: `check failed (${err?.message || err})` };
  }
  if (verdict?.allowed) return limits;
  console.error(`⚠️  successfactors: ${entry.name} asks for a higher max_pages/max_jobs but robots.txt does not allow ${new URL(url).pathname} (${verdict?.reason || 'disallowed'}) — keeping the defaults`);
  // Drop only what exceeds the defaults; a lower CSB max_pages still applies.
  const defPages = kind === 'csb' ? CSB_MAX_PAGES_PER_LOCALE : MAX_PAGES;
  const keepPages = posInt(entry?.max_pages) !== null && entry.max_pages <= defPages;
  const keepJobs = posInt(entry?.max_jobs) !== null && entry.max_jobs <= MAX_JOBS;
  return resolveLimits({ ...entry, max_pages: keepPages ? entry.max_pages : undefined, max_jobs: keepJobs ? entry.max_jobs : undefined }, kind);
}

// CSB strategy: discover locales, paginate the JSON jobs API per locale, dedup
// by id across locales+pages. `total` from the first page bounds pagination;
// an empty/short page also stops the loop.
//
// `probe: true` marks the post-RMK fallback probe: RMK already answered (the
// board is reachable, just empty of tiles), so an all-locales CSB failure must
// NOT read as a dead board — return [] instead of throwing.
/** @param {import('./_types.js').PortalEntry} entry @param {any} cfg @param {import('./_types.js').Context} ctx @param {{probe?: boolean}} [opts] */
async function fetchCsb(entry, cfg, ctx, { probe = false, quiet = false } = {}) {
  // The post-RMK probe only looks for the empty-shell signature: defaults, no
  // robots check, so an RMK entry's raised max_pages is never read as a CSB raise.
  const limits = probe
    ? resolveLimits({ ...entry, max_pages: undefined, max_jobs: undefined }, 'csb')
    : await limitsFor(entry, 'csb', cfg.jobsApi, ctx);
  const { maxPages } = limits;
  // A quiet probe (the entry will be re-read in full at its own limits) only needs
  // to learn whether the board has any posting, so it stops at the first one and
  // the full read does not repeat its requests.
  const maxJobs = quiet ? 1 : limits.maxJobs;
  let locales = CSB_DEFAULT_LOCALES;
  try {
    const html = await ctx.fetchText(cfg.searchPage, { redirect: 'error', headers: { accept: 'text/html' } });
    const discovered = extractLocales(html);
    if (discovered.length) locales = discovered;
  } catch {
    // Discovery is best-effort; fall back to the default locale set.
  }

  const jobs = [];
  const truncated = [];
  const seen = new Set();
  // When EVERY locale fails without a single successful request the board is
  // unreachable, not empty — THROW so scan/portal-health record a failure
  // instead of "live but empty" (meituan/tencent idiom). The FIRST failure is
  // retained and surfaced: later locales usually fail for the same root cause,
  // and keeping the first makes the thrown error deterministic.
  let succeededOnce = false;
  let firstErr = null;

  for (const locale of locales) {
    if (jobs.length >= maxJobs) {
      truncated.push(`locales not read: ${locales.slice(locales.indexOf(locale)).join(', ')}`);
      break;
    }
    const fetchPage = (page) => ctx.fetchJson(cfg.jobsApi, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ keywords: '', locale, location: '', pageNumber: page, sortBy: CSB_SORT }),
    });
    let total = null;
    let failed = false;
    // True only when a cap (page or job) ended the read of this locale. A short
    // page, an empty page, the reported total, or a fetch error are not caps.
    let capHit = false;
    const localeIds = new Set();
    for (let sweep = 0; sweep < CSB_SWEEPS; sweep++) {
      const lastPageFor = (count) => Math.min(maxPages - 1, Math.ceil(count / CSB_PAGE_SIZE) - 1);
      let lastPage = total === null ? maxPages - 1 : lastPageFor(total);
      let page = 0;
      // Page 0 carries totalJobs. With a total known, the remaining pages go out
      // CSB_PAGE_CONCURRENCY at a time; without one we cannot tell where the
      // board ends, so pages stay one at a time and a short page stops the loop.
      pages: while (page <= lastPage) {
        const width = total === null ? 1 : CSB_PAGE_CONCURRENCY;
        const batch = Array.from({ length: Math.min(width, lastPage - page + 1) }, (_, i) => page + i);
        const results = await Promise.allSettled(batch.map(fetchPage));
        for (let i = 0; i < batch.length; i++) {
          const result = results[i];
          if (result.status === 'rejected') {
            firstErr ??= result.reason;
            failed = true;
            break pages; // this locale failed (e.g. 307 legacy redirect) — try the next
          }
          succeededOnce = true;
          const json = result.value;
          if (total === null) {
            total = typeof json?.totalJobs === 'number' ? json.totalJobs : null;
            if (total !== null) lastPage = lastPageFor(total);
          }
          // Page-fullness checks below use the raw response count, not rows.length:
          // parseCsbJobs drops id/title-less records, and a full API page with a
          // few dropped records would otherwise look "short" and stop pagination
          // before reaching later pages that still hold valid jobs.
          const rawCount = Array.isArray(json?.jobSearchResult) ? json.jobSearchResult.length : 0;
          if (rawCount === 0) break pages;
          const rows = parseCsbJobs(json, cfg, locale);

          for (const row of rows) {
            localeIds.add(row.id);
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            const job = { title: row.title, url: row.url, company: entry.name, location: row.location };
            if (typeof row.postedAt === 'number') job.postedAt = row.postedAt;
            jobs.push(job);
            if (jobs.length >= maxJobs) {
              capHit = total === null || localeIds.size < total;
              break pages;
            }
          }
          if (batch[i] === maxPages - 1 && rawCount >= CSB_PAGE_SIZE && (total === null || (batch[i] + 1) * CSB_PAGE_SIZE < total)) capHit = true;
          // Stop once we've covered the reported total, or on a short page.
          if (total !== null && (batch[i] + 1) * CSB_PAGE_SIZE >= total) break pages;
          if (rawCount < CSB_PAGE_SIZE) break pages;
        }
        page = batch[batch.length - 1] + 1;
      }
      if (failed || total === null || localeIds.size >= total || jobs.length >= maxJobs) break;
    }
    // A cap, not a failure or the natural end, stopped this locale: say so instead
    // of returning a silent subset.
    if (capHit) truncated.push(total !== null ? `${locale} ${localeIds.size} of ${total} jobs` : `${locale} ${localeIds.size} jobs, total unknown`);
  }
  if (truncated.length && !quiet) warnTruncated(entry, truncated.join('; '), 'csb', maxPages, maxJobs);
  if (!probe && !succeededOnce && firstErr) throw firstErr;
  return jobs;
}

// Names the entry and the knobs that raise the cap that stopped the read, in
// the wording eightfold.mjs uses for the same situation.
/** @param {any} entry @param {string} what @param {'rmk'|'csb'} kind @param {number} maxPages @param {number} maxJobs */
function warnTruncated(entry, what, kind, maxPages, maxJobs) {
  const pages = kind === 'csb' ? `max_pages=${maxPages} per locale` : `max_pages=${maxPages}`;
  console.error(`⚠️  successfactors: ${entry.name} truncated at ${pages}, max_jobs=${maxJobs} (${what}) — raise max_pages and/or max_jobs on this entry for more`);
}

// RMK strategy: the original /tile-search-results/ HTML-fragment scraper.
/** @param {import('./_types.js').PortalEntry} entry @param {any} cfg @param {import('./_types.js').Context} ctx */
async function fetchRmk(entry, cfg, ctx) {
  // A bounded probe (ctx.maxPages, e.g. verify-portals) never raises the cap, so
  // it skips the robots check and stops at ctx.maxPages without warning.
  const probeLimit = posInt(ctx.maxPages);
  const { maxPages: cappedPages, maxJobs } = probeLimit
    ? resolveLimits({ ...entry, max_pages: undefined, max_jobs: undefined }, 'rmk')
    : await limitsFor(entry, 'rmk', `${cfg.tileApi}?startrow=${RMK_GATE_STARTROW}`, ctx);
  const maxPages = probeLimit ? Math.min(cappedPages, probeLimit) : cappedPages;
  const jobs = [];
  const seen = new Set();
  const seenRaw = new Set();
  let startrow = 0;
  // True when the loop ended on a cap while the last page was still delivering
  // new postings — i.e. the board very likely has more. The RMK fragment carries
  // no total, so the warning can only say "at least".
  let capped = false;
  let pageSize = 0;
  const gate = ctx?.robotsGate || robotsAllows;
  for (let page = 0; page < maxPages; page++) {
    // Pages past the default cap are extra crawling: check each actual startrow
    // URL (a rule can allow one offset and disallow a later one). On a denial,
    // stop here at what the defaults would have read and say so.
    if ((page >= MAX_PAGES || jobs.length >= MAX_JOBS) && !probeLimit) {
      let ok = false;
      try { ok = !!(await gate(`${cfg.tileApi}?startrow=${startrow}`))?.allowed; } catch { ok = false; }
      if (!ok) {
        console.error(`⚠️  successfactors: ${entry.name} stopped raising max_pages at page ${page + 1} because robots.txt does not allow ${new URL(cfg.tileApi).pathname}?startrow=${startrow} — keeping what the defaults read`);
        capped = false;
        break;
      }
    }
    const htmlText = await ctx.fetchText(`${cfg.tileApi}?startrow=${startrow}`, {
      redirect: 'error',
      headers: { accept: 'text/html' },
    });
    const tiles = parseTiles(htmlText, cfg.jobBase);
    // Pagination follows the rows the source returned, not the ones parseTiles kept:
    // a title-less tile must not end the walk or leave the next offset overlapping.
    const rawIds = [...htmlText.matchAll(/<li class="job-tile job-id-(\d+)/g)].map((m) => m[1]);
    if (rawIds.length === 0) break;
    // Fullness is judged on the rows the source returned, not on the tiles that
    // survived parseTiles' filtering.
    const rawTiles = rawIds.length;
    if (page === 0) pageSize = rawTiles;

    let fresh = rawIds.filter((id) => !seenRaw.has(id)).length;
    for (const id of rawIds) seenRaw.add(id);
    for (const tile of tiles) {
      if (seen.has(tile.id)) continue;
      seen.add(tile.id);
      jobs.push({
        title: tile.title,
        url: tile.url,
        company: entry.name,
        location: tile.location,
      });
    }
    // No new ids this page → server ignored the offset (or we've looped). Stop.
    if (fresh === 0) break;
    startrow += rawTiles;
    if (jobs.length >= maxJobs || page === maxPages - 1) {
      // A short final page means the board ended on its own, not at the cap.
      capped = !probeLimit && (jobs.length >= maxJobs || rawTiles >= pageSize);
      break;
    }
  }
  if (capped) warnTruncated(entry, `stopped at ${Math.min(jobs.length, maxJobs)} jobs, more were still being returned`, 'rmk', maxPages, maxJobs);
  // The cap is checked between pages, so the last page can overshoot it.
  return jobs.slice(0, maxJobs);
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
    // RMK answered (healthy, possibly legitimately empty) — the CSB call here
    // is only a probe for the empty-shell signature, so it must not turn a
    // failing/absent CSB endpoint into a dead-board throw.
    // An opted-in entry (raised max_pages/max_jobs) that turns out to be CSB gets
    // a second, robots-gated read at its own limits; the bounded probe stays quiet.
    const raised = resolveLimits(entry, 'csb').raised;
    const probed = await fetchCsb(entry, cfg, ctx, { probe: true, quiet: raised });
    if (raised && probed.length > 0) return fetchCsb(entry, cfg, ctx);
    return probed;
  },
};
