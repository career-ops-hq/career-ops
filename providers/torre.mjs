// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Torre provider — the public opportunity search behind torre.ai
// (POST https://search.torre.co/opportunities/_search). Public, zero-auth JSON.
// Torre is a pan-LatAm talent marketplace (Colombia-born); its board carries
// LatAm-heavy remote roles that never reach Greenhouse/Lever/Ashby.
//
// Wire in via a `job_boards:` entry with `provider: torre`.
//
// Portal entry fields (all optional):
//   search      — text handed to Torre's `skill/role` filter (e.g. "engineering
//                 manager"). STRONGLY recommended; see the firehose note below.
//   experience  — required companion to `search` (default "1-plus-year"); one of
//                 EXPERIENCE_LEVELS below.
//   remote_only — true → only remote postings (default: unset, no remote filter)
//
// There is no max_pages: the endpoint returns AT MOST 20 rows per query and
// cannot be paged (see quirk 2). Breadth comes from configuring several entries
// with different `search` terms, not from deeper paging.
//
// ── Two API behaviours this provider is built around ──────────────────
//
// 1. UNKNOWN FILTER KEYS ARE SILENTLY IGNORED. Posting `{"objective":{"text":
//    "engineering manager"}}` returns the FULL unfiltered catalogue (~304k
//    postings) with a 200 and no error — the same `total` as `{}`. A provider
//    that trusted an unverified filter would quietly walk the entire board.
//    Only filters observed to actually move `total` are sent:
//      {"skill/role":{"text": <search>}}  304,735 → 39,771 for "engineering manager"
//      {"remote":{"term":true}}           304,735 → 77,428
//    Do NOT add a filter key here without first confirming it changes `total`.
//
//    Because a silently-ignored filter cannot be detected from a single
//    response, correctness never depends on the server filtering: the single
//    capped request (quirk 2) plus scan.mjs's own title_filter/location_filter
//    do the real gating. The worst case of a filter being ignored is less
//    relevant results, never an unbounded scan.
//
// 2. THE RESULT SET IS CAPPED AT 20 AND CANNOT BE PAGED. `size` above 20
//    returns an EMPTY array rather than clamping (so a naive bump reads as
//    "board is empty", not as an error), and every pagination form is silently
//    ignored — `?offset=N`, `?page=N`, `?from=N` and a body `offset` all return
//    the byte-identical first 20 rows. This provider therefore issues exactly
//    ONE request per entry. Do not add a paging loop back: it cannot advance,
//    and its results would be discarded as duplicates.
//
// 3. `skill/role` REQUIRES a companion `experience`. `{"skill/role":{"text":X}}`
//    alone returns HTTP 500 at every page size, and an unrecognised experience
//    value is rejected too — so it is a validated enum, not free text. Every
//    accepted value returns the identical `total`, i.e. it is required but inert
//    for filtering; it exists to satisfy the schema. This is invisible to a
//    mocked unit test and only shows up against the live API, hence the
//    EXPERIENCE_LEVELS allowlist and the always-paired emission below.
//
// Note also that `remote` measurably narrows results ON ITS OWN, but stops
// changing `total` once combined with `skill/role` — another reason precision
// is left to the scanner's own filters rather than trusted to this API.
//
// Torre's ranking is not relevance-ordered for a `skill/role` text filter, so a
// broad `search` returns loosely-related roles. That is expected and harmless —
// title_filter drops them downstream.

const SEARCH_ENDPOINT = 'https://search.torre.co/opportunities/_search';
const TRUSTED_API_HOST = 'search.torre.co';
// Postings are displayed on torre.ai; /post/{id} is the canonical public permalink.
const POSTING_BASE = 'https://torre.ai/post/';
// Hard ceiling: >20 returns an empty array, and no offset/page form advances.
const PAGE_SIZE = 20;
// Torre ids are short URL-safe tokens (e.g. "NwBp2Axr"). Anchored so an id from
// the payload can never inject a path segment or query into the permalink.
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
// Values the API accepts for the required `skill/role.experience` companion,
// confirmed live; anything else is rejected server-side. Every one returns the
// same result set, so the default is arbitrary among them.
const EXPERIENCE_LEVELS = new Set([
  'potential-to-develop',
  '1-plus-year',
  '2-plus-years',
  '3-plus-years',
  '5-plus-years',
]);
const DEFAULT_EXPERIENCE = '1-plus-year';

/** @param {string} url */
function assertTorreUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`torre: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`torre: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_API_HOST) {
    throw new Error(`torre: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_API_HOST}`);
  }
  return url;
}

/**
 * Build the search body from the portal entry. Only filters proven to affect
 * `total` are emitted — see the header note. Exported for tests.
 *
 * @param {any} entry
 * @returns {object}
 */
export function buildTorreQuery(entry) {
  /** @type {Record<string, unknown>} */
  const body = {};

  const search = typeof entry?.search === 'string' ? entry.search.trim() : '';
  if (search) {
    // `experience` is mandatory here — omitting it is a hard 500, so it is
    // always emitted alongside `text` rather than being conditional on config.
    const configured = typeof entry?.experience === 'string' ? entry.experience.trim() : '';
    if (configured && !EXPERIENCE_LEVELS.has(configured)) {
      throw new Error(
        `torre: invalid experience "${configured}" — must be one of: ${[...EXPERIENCE_LEVELS].join(', ')}`,
      );
    }
    body['skill/role'] = { text: search, experience: configured || DEFAULT_EXPERIENCE };
  }

  // Only the positive case is expressible: `{"remote":{"term":false}}` is not a
  // verified filter, so a falsy remote_only sends no key at all rather than a
  // filter that might be ignored while looking effective.
  if (entry?.remote_only === true) body.remote = { term: true };

  return body;
}

/**
 * Normalize a single Torre opportunity. Exported for tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `objective`, trimmed (items without one are dropped).
 *   - url:      `https://torre.ai/post/{id}` — built from the id rather than
 *               taken from the payload, so there is no attacker-controlled URL.
 *               An id failing ID_RE drops the item. This is the dedup key.
 *   - company:  `organizations[0].name`, falling back to the entry name, then
 *               "Torre". Torre lists solo/anonymous posters with no org.
 *   - location: "Remote" when `remote` is true, else the joined `locations`
 *               array (Torre sends country or "City, State, Country" strings).
 *               A remote posting keeps its country list appended when present,
 *               since LatAm roles are commonly "remote, but these countries".
 *   - postedAt: `created` (ISO 8601) → epoch ms (omitted when absent/unparseable).
 *
 * Closed postings are dropped: `status` is "open" on live rows, and the search
 * endpoint does return closed ones.
 *
 * @param {any} o
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeTorreOpportunity(o, fallbackCompany) {
  if (!o || typeof o !== 'object') return null;

  const title = typeof o.objective === 'string' ? o.objective.trim() : '';
  if (!title) return null;

  // Drop anything not explicitly open. An absent status is treated as open —
  // the field is present on every observed row, but a missing one must not
  // silently empty the feed if Torre stops sending it.
  if (typeof o.status === 'string' && o.status.trim() && o.status.trim() !== 'open') return null;

  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!ID_RE.test(id)) return null;
  const url = `${POSTING_BASE}${id}`;

  let company = '';
  if (Array.isArray(o.organizations)) {
    const named = o.organizations.find(
      (org) => org && typeof org.name === 'string' && org.name.trim(),
    );
    if (named) company = named.name.trim();
  }
  if (!company) company = fallbackCompany || 'Torre';

  const countries = Array.isArray(o.locations)
    ? o.locations.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim())
    : [];
  let location = countries.join(', ');
  if (o.remote === true) location = location ? `Remote — ${location}` : 'Remote';

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };

  if (typeof o.created === 'string' && o.created.trim()) {
    const ms = Date.parse(o.created);
    if (Number.isFinite(ms)) job.postedAt = ms;
  }

  return job;
}

/** @type {Provider} */
export default {
  id: 'torre',

  async fetch(entry, ctx) {
    assertTorreUrl(SEARCH_ENDPOINT);
    const body = JSON.stringify(buildTorreQuery(entry));
    const fallbackCompany = entry?.name;

    // Exactly one request: the endpoint caps at 20 rows and ignores every
    // pagination form, so a loop could only refetch the same page (quirk 2).
    // ctx.maxPages needs no handling for the same reason — one page is all
    // there is, which is already what the health probe wants.
    const url = `${SEARCH_ENDPOINT}?offset=0&size=${PAGE_SIZE}`;
    // redirect:'error' prevents SSRF via server-side redirects
    const json = await ctx.fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
    });

    if (!json || !Array.isArray(json.results)) {
      throw new Error(
        `torre: unexpected API response — expected { results: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
      );
    }

    const out = [];
    const seen = new Set();
    for (const o of json.results) {
      const normalized = normalizeTorreOpportunity(o, fallbackCompany);
      if (!normalized || seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      out.push(normalized);
    }
    return out;
  },
};
