// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// goodjobs provider — self-hosted job-search aggregator
// (https://github.com/vnk8071/goodjobs), a sibling project of this one's
// author. goodjobs itself scrapes 18 boards (LinkedIn, ITViec, TopCV,
// VietnamWorks, CareerViet, TopDev, JobsGo, CareerLink, Glints, ViecOi,
// Indeed VN, plus a global US/UK/SG set) and exposes them behind one FastAPI
// backend. This provider is a THIN CLIENT of that backend, not another
// scraper — it calls goodjobs' own public, no-auth `POST /scrape` endpoint
// and normalizes the JSON array it returns.
//
// Wire in via a `job_boards:` entry with `provider: goodjobs`. Unlike
// per-tenant ATS providers, goodjobs is self-hosted: there is no single fixed
// host, careers_url pattern, or other signal to auto-detect against, so
// `detect()` always returns null (same style as glints.mjs / jobstreet.mjs)
// — see its own comment for why a version that matched on `entry.provider`
// would have been dead code. `api` picks which deployment to call; it
// defaults to the author's own public backend (https://api.goodjobs.io.vn)
// but any HTTPS deployment works.
//
// NOTE ON THE DEFAULT HOST: the FRONTEND is served from goodjobs.io.vn
// (GitHub Pages), but the FastAPI backend `/scrape` lives on a different
// subdomain — confirmed live 2026-08-30 by reading the frontend's own built
// JS bundle for its baked-in `VITE_API_URL` (`api.goodjobs.io.vn`), then
// verifying `GET https://api.goodjobs.io.vn/health` responds
// `{"status":"ok",...}`. Pointing this provider at the bare goodjobs.io.vn
// frontend host would 404 on every request — it serves static HTML, not JSON.
//
// TWO THINGS WORTH KNOWING BEFORE CONFIGURING THIS:
//
// 1. career-ops' provider SSRF guard (_ip-guard.mjs) refuses to connect to
//    loopback/private/link-local addresses for ANY provider fetch. A goodjobs
//    instance running locally via `docker compose up` (localhost:8000) is
//    therefore NOT reachable from this provider — only a publicly routable
//    deployment (the author's own api.goodjobs.io.vn, or a self-hosted
//    domain) works. This is the SSRF guard doing its job, not a bug in this
//    file.
//
// 2. Unlike `/scrape-stream`, the blocking `/scrape` endpoint this provider
//    calls has NO rate limiter and NO concurrency semaphore on the server
//    side (backend/main.py's `scrape()` — confirmed by reading the handler;
//    `check_rate_limit`/`_get_sem()` are only wired into `/scrape-stream`).
//    On a cache miss it fires all configured scrapers concurrently through a
//    shared 6-worker thread pool with no per-request guard.
//
//    HISTORICAL NOTE, kept because it explains a design choice below: live
//    testing against the public instance on 2026-08-30 initially hit a fast,
//    reproducible `500 Internal Server Error` on every `/scrape` call tried
//    (including a documented warmup keyword), while `/health` and
//    `/recent-jobs` both answered normally. Root cause, traced in the
//    goodjobs repo itself: several scrapers write `summary_description:
//    None` as a "not yet summarized" sentinel, but `Job.summary_description`
//    was typed as a bare `str`, which Pydantic rejects for an explicit
//    `None` — and `/scrape` is the only route that validates its response
//    against that model (`response_model=list[Job]`), so any cached job
//    still carrying the sentinel crashed the request. Fixed upstream same
//    day (goodjobs@0748103, widened the field to `str | None`) and verified
//    live afterward. This provider's error handling was written assuming a
//    route this thin can still fail server-side for reasons outside
//    career-ops' control: a 500 is retried twice via fetchJsonWithRetry,
//    then surfaced as a normal thrown error — never reported as a silent
//    empty board. That assumption held up in practice and is worth keeping
//    regardless of any one bug's fix.
//
// REQUEST SHAPE. goodjobs' own ScrapeRequest model requires a non-empty
// `keyword` — there is no board-wide "all jobs" mode the way careerviet/
// itviec have, so `searchKeywords` is REQUIRED on the portal entry (mirrors
// the field name those two providers use for the same purpose, but here it's
// mandatory rather than optional). `searchLocation` and `searchCountry` are
// optional and default to goodjobs' own API defaults ("Ho Chi Minh City" /
// "VN").
//
// RESPONSE SHAPE. Each item is `{title, company, location, link, source,
// posted, posted_date, posted_ts, description, summary_description, skills,
// logo}` (backend/src/models.py's Job model). `link` points at the ORIGINAL
// posting on whichever of the 18 underlying boards produced it — by design
// there is no single host to pin an allowlist to (that would defeat the
// point of an aggregator), so each link is validated only as a well-formed
// absolute http(s) URL, not against a fixed hostname.
//
// `description` is HTML, not plain text: goodjobs' backend/src/utils.py
// `_clean_html()` only decomposes <script>/<style> and drops noisy
// attributes, then returns `str(soup)` — real tags stay in and BeautifulSoup
// re-escapes bare-text entities. normalizeJob() runs it through this repo's
// shared HTML→text pipeline (_html-to-text.mjs), same as every other
// JSON-payload provider (greenhouse, smartrecruiters, gem, recruitee,
// remotli), so scan.mjs's content_filter matches plain words rather than
// attribute soup and DESCRIPTION_CAP applies.

import { fetchJsonWithRetry } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

/**
 * The author's own public backend; overridable per entry via `api:`. NOT the
 * same host as the goodjobs.io.vn frontend — see the file header comment.
 */
const DEFAULT_API_BASE = 'https://api.goodjobs.io.vn';

/** goodjobs' own ScrapeRequest defaults — mirrored here for parity, not guessed. */
const DEFAULT_LOCATION = 'Ho Chi Minh City';
const DEFAULT_COUNTRY = 'VN';

/**
 * Uncached multi-source scrapes (18 boards, some headless-browser-driven) can
 * run well past the 10s repo-wide default — measured slow paths in goodjobs'
 * own README run ~14s even in its faster streaming mode, and a genuine cold
 * sweep across all 18 sources was measured taking ~33s live. 30s gives a
 * cached hit plenty of headroom and a cold sweep a real chance to finish.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Just ONE retry, not the shared default of two. fetchJsonWithRetry's default
 * policy treats a timeout the same as a 429/5xx, but a timeout on THIS
 * endpoint is as likely to mean "still genuinely scraping" as "transient
 * failure" — retrying it doesn't fix that, it only compounds the wait. Worst
 * case with two retries (three full 30s timeouts plus backoff) is ~90s,
 * tying up a scan.mjs worker slot for that whole span; one retry caps it
 * around 60s. It also matters that `/scrape` has no rate limiter or
 * concurrency guard server-side (see the file header) — hammering it with
 * the full default retry count on failure adds load to a backend that
 * already can't shed it on its own.
 */
const RETRY_POLICY = { retries: 1 };

/**
 * Resolve which goodjobs deployment to call. Only HTTPS is accepted — this
 * is what also keeps a local `http://localhost:8000` dev instance out (it
 * would additionally be blocked by the SSRF guard's loopback check, but
 * requiring HTTPS up front gives a clearer error message than a DNS-lookup
 * failure would).
 * @param {{ api?: string }} [entry]
 * @returns {string} Origin, no trailing slash.
 */
export function resolveApiBase(entry) {
  const raw = typeof entry?.api === 'string' && entry.api.trim() ? entry.api.trim() : DEFAULT_API_BASE;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`goodjobs: invalid api URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`goodjobs: api URL must use HTTPS: ${raw}`);
  }
  return parsed.origin;
}

/**
 * Build the `/scrape` request body from a portal entry. Throws when
 * `searchKeywords` is missing/blank — goodjobs' own API 400s on an empty
 * keyword, so failing here gives a config-time error instead of a confusing
 * runtime HTTP 400.
 * @param {{ searchKeywords?: string, searchLocation?: string, searchCountry?: string }} [entry]
 * @returns {{ keyword: string, location: string, country: string }}
 */
export function buildRequestBody(entry) {
  const keyword = String(entry?.searchKeywords ?? '').trim();
  if (!keyword) {
    throw new Error('goodjobs: searchKeywords is required on the portal entry — the API rejects an empty keyword');
  }
  const location = String(entry?.searchLocation ?? '').trim() || DEFAULT_LOCATION;
  const country = String(entry?.searchCountry ?? '').trim() || DEFAULT_COUNTRY;
  return { keyword, location, country };
}

/**
 * Normalize one goodjobs response item into the scanner's Job shape.
 * Returns null for an item missing a title or a well-formed absolute
 * http(s) url — dropped rather than emitted half-populated.
 * @param {any} item
 * @returns {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number} | null}
 */
export function normalizeJob(item) {
  if (item == null || typeof item !== 'object') return null;

  const title = String(item.title ?? '').trim();
  if (!title) return null;

  const rawUrl = String(item.link ?? '').trim();
  let url;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    url = parsed.toString();
  } catch {
    return null;
  }

  const company = String(item.company ?? '').trim();
  const location = String(item.location ?? '').trim();
  // goodjobs' `description` carries HTML markup (see the file header); decode +
  // strip it via the shared pipeline. Fall back to the AI `summary_description`
  // only when the full description is empty/absent.
  const description = htmlToText(item.description) || htmlToText(item.summary_description);

  // posted_ts is Unix SECONDS (backend/src/models.py); a missing/zero/negative
  // value means "no usable date" rather than epoch itself, so it's omitted
  // like every other provider's postedAt contract.
  const postedTs = Number(item.posted_ts);
  const postedAt = Number.isFinite(postedTs) && postedTs > 0 ? Math.round(postedTs * 1000) : undefined;

  return {
    title,
    url,
    company,
    location,
    ...(description ? { description } : {}),
    ...(postedAt !== undefined ? { postedAt } : {}),
  };
}

/** @type {Provider} */
export default {
  id: 'goodjobs',

  detect(_entry) {
    // goodjobs is a self-hosted aggregator, not a company ATS or a board with
    // a fixed host to key auto-detection off — same class as glints.mjs /
    // jobstreet.mjs. Auto-detection is intentionally not supported: use
    // `provider: goodjobs` explicitly in portals.yml.
    //
    // A version of this that checked `entry?.provider === 'goodjobs'` and
    // returned a hit would be dead code, not just unnecessary: resolveProvider()
    // in _registry.mjs resolves an explicit `provider:` field via a direct
    // id→provider map lookup and never calls detect() on that path at all —
    // detect() only runs in the auto-detect fallback loop, which only fires
    // for entries that *don't* set `provider:`. Since `provider: goodjobs` is
    // the only way to select this provider, that branch never executes in
    // production.
    return null;
  },

  async fetch(entry, ctx) {
    const base = resolveApiBase(entry);
    const body = buildRequestBody(entry);

    const data = await fetchJsonWithRetry(ctx, `${base}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      timeoutMs: REQUEST_TIMEOUT_MS,
    }, RETRY_POLICY);

    if (!Array.isArray(data)) {
      throw new Error(`goodjobs: unexpected /scrape response — expected a JSON array, got ${data === null ? 'null' : typeof data}`);
    }

    return data.map(normalizeJob).filter((job) => job !== null);
  },
};
