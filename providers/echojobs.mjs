// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// EchoJobs provider — board-wide public JSON feed of tech jobs aggregated from
// company ATS boards (https://echojobs.io/api/jobs). Public, zero-auth, paginated
// (`?page=N&per_page=M`). The broad feed is fetched so scan.mjs's title_filter
// gates on the configured titles; pages are pulled until one comes back short or
// the page cap is reached (default 3, override with `max_pages`).
//
// Each row's `url` is the ORIGINAL ATS posting (e.g. jobs.ashbyhq.com/…), so —
// unlike the feed host — job URLs are not pinned to echojobs.io; only the feed
// fetch is host-locked. The url is display-only and never server-fetched here.
//
// Wire in via a `job_boards:` entry with `provider: echojobs`.

const FEED_BASE = 'https://echojobs.io/api/jobs';
const TRUSTED_HOST = 'echojobs.io';
const PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 50;

/** @param {string} url */
function assertEchojobsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`echojobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`echojobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`echojobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Normalize a single EchoJobs feed item. Exported for tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (items without one are dropped).
 *   - url:      `url` — an absolute `https:` posting URL on the company's own ATS
 *               host (NOT echojobs.io), used as the dedup key. Non-https/malformed
 *               URLs drop the item.
 *   - company:  `company_name`, falling back to the portal entry name, then "EchoJobs".
 *   - location: the joined `locations` array; falls back to "Remote" when the
 *               posting has no listed place but `remote_type` is remote/hybrid.
 *   - postedAt: `posted_at` (already epoch ms) when a positive finite number.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeEchojobsJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  // url must be an absolute https link; it lives on the company's ATS host, so
  // it is NOT restricted to echojobs.io.
  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:') url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const company =
    typeof j.company_name === 'string' && j.company_name.trim()
      ? j.company_name.trim()
      : fallbackCompany || 'EchoJobs';

  let location = '';
  if (Array.isArray(j.locations)) {
    location = j.locations
      .filter((l) => typeof l === 'string' && l.trim())
      .map((l) => l.trim())
      .join(', ');
  }
  if (!location && (j.remote_type === 'remote' || j.remote_type === 'hybrid')) location = 'Remote';

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  // `posted_at` is already epoch milliseconds.
  if (Number.isFinite(j.posted_at) && j.posted_at > 0) job.postedAt = j.posted_at;
  return job;
}

/** @type {Provider} */
export default {
  id: 'echojobs',

  detect(entry) {
    return entry?.provider === 'echojobs' ? { url: FEED_BASE } : null;
  },

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      // Validate the URL actually fetched (not just a constant) so the host pin
      // is meaningful, then redirect:'error' blocks SSRF via server-side
      // redirects — together they keep every page request on echojobs.io.
      const url = assertEchojobsUrl(`${FEED_BASE}?per_page=${PER_PAGE}&page=${page}`);
      const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
      if (!json || !Array.isArray(json.jobs)) {
        throw new Error(
          `echojobs: unexpected API response on page ${page} — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of json.jobs) {
        const normalized = normalizeEchojobsJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      if (json.jobs.length < PER_PAGE) break; // short page → last page reached
    }
    return out;
  },
};
