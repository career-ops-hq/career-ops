// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Meta provider — metacareers.com. Long assumed browser-only ("GraphQL doc_id +
// bot wall"), but the wall is header-shaped, not cookie-shaped: a request that
// carries a full, self-consistent browser header set is served normally, while a
// bare curl gets HTTP 400 from the edge. No session, no cookies, no login.
//
// Two steps:
//
//   1. GET {origin}/jobsearch/            (browser headers; /jobs 301s here)
//      → scrape the per-response LSD token out of the HTML:
//        ["LSD",[],{"token":"AdS…"}]
//      The token is mandatory and must be genuine — omitting it, or sending a
//      made-up value, returns the same HTML 400 error page as a bare request.
//
//   2. POST {origin}/api/graphql/         (form-encoded)
//        lsd, fb_api_req_friendly_name=CPJobSearchSourceQuery,
//        doc_id, variables={"search_input":{…}}
//      → { data: { job_search_with_featured_jobs: { all_jobs: [
//            { id, title, locations: [ "Menlo Park, CA", … ] } ] } } }
//
// The whole board (~780 postings) comes back in that ONE response — there is no
// pagination to walk. `results_per_page: null` means unlimited.
//
// Each posting exposes exactly three fields: id, title, locations. There is no
// posting date in this payload, so postedAt is always omitted (rather than
// guessed) and `max_posting_age_days` simply never filters Meta — consistent
// with the scanner's "don't penalize missing data" rule.
//
// Public URL is {origin}/jobs/{id}/, which 301s to /profile/job_details/{id}/.
// We emit the short form: it is what the site's own listing links to, and it
// survives the detail-page path being reshuffled.
//
// ── doc_id rotation ──────────────────────────────────────────────────────────
// doc_id identifies a *persisted* query and Meta rotates it on deploy. A stale
// id fails closed (GraphQL returns an error payload, not partial data), so this
// provider self-heals: on a miss it re-derives the current id by pulling the
// page's JS bundles and reading the Relay operation module
//   __d("CPJobSearchSourceQuery_candidate_portalRelayOperation",[],
//       function(…){a.exports="27807005005556827"})
// That recovery costs a few MB of JS, so it runs only after the pinned id has
// actually failed — the happy path stays at two small requests. Pin a known-good
// id per entry with `meta.doc_id` to skip the default.

const ALLOWED_HOSTS = new Set(['www.metacareers.com', 'metacareers.com']);
const DEFAULT_ORIGIN = 'https://www.metacareers.com';
const FRIENDLY_NAME = 'CPJobSearchSourceQuery';
// Verified live 2026-08-03. Self-healing below covers rotation.
const DEFAULT_DOC_ID = '27807005005556827';
const RELAY_MODULE = 'CPJobSearchSourceQuery_candidate_portalRelayOperation';
const MAX_BUNDLES_SCANNED = 12; // bundle list is ~10; bound the recovery walk

// The edge rejects requests whose header set doesn't look like a real navigation
// (this is the entire "bot wall"). Keep these together and self-consistent.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const NAV_HEADERS = {
  'user-agent': BROWSER_UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

/** Full job board in one shot: no query, no facets, no page cap. */
const SEARCH_INPUT = {
  q: null,
  divisions: [],
  offices: [],
  roles: [],
  leadership_levels: [],
  saved_jobs: [],
  saved_searches: [],
  sub_teams: [],
  teams: [],
  is_leadership: false,
  is_remote_only: false,
  sort_by_new: false,
  results_per_page: null,
};

/** @param {string} url */
function assertMetaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`meta: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`meta: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`meta: untrusted hostname "${parsed.hostname}" — must be one of ${[...ALLOWED_HOSTS].join(', ')}`);
  }
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || DEFAULT_ORIGIN;
  let origin = DEFAULT_ORIGIN;
  try {
    const u = new URL(raw);
    if (ALLOWED_HOSTS.has(u.hostname)) origin = u.origin;
  } catch {
    /* fall back to the canonical origin */
  }
  const block = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
  const pinned = typeof block.doc_id === 'string' && block.doc_id.trim();
  return { origin, docId: pinned || DEFAULT_DOC_ID, pinned: Boolean(pinned) };
}

/** Pull the per-response LSD token out of the search page HTML. */
export function parseLsdToken(html) {
  const m =
    html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) || html.match(/"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

/** Collect the page's JS bundle URLs (used only by doc_id recovery). */
export function parseBundleUrls(html) {
  const raw = [...html.matchAll(/https:\\?\/\\?\/static\.xx\.fbcdn\.net\\?\/rsrc\.php\\?\/[^"'\s\\]+\.js/g)].map((m) =>
    m[0].replace(/\\\//g, '/'),
  );
  return [...new Set(raw)];
}

/** Read the persisted-query id out of a Relay operation module. */
export function parseDocId(bundleSource) {
  const re = new RegExp(`"${RELAY_MODULE}"\\s*,\\s*\\[\\]\\s*,\\s*\\(function\\([^)]*\\)\\{[^}]*?exports\\s*=\\s*"(\\d+)"`);
  const m = bundleSource.match(re);
  return m ? m[1] : null;
}

/** @param {any} json */
function extractJobs(json) {
  const all = json?.data?.job_search_with_featured_jobs?.all_jobs;
  return Array.isArray(all) ? all : null;
}

/** @type {Provider} */
export default {
  id: 'meta',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    try {
      if (ALLOWED_HOSTS.has(new URL(url).hostname)) return { url };
    } catch {
      /* not absolute */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    const searchUrl = assertMetaUrl(`${cfg.origin}/jobsearch/`);
    const graphqlUrl = assertMetaUrl(`${cfg.origin}/api/graphql/`);

    const html = await ctx.fetchText(searchUrl, { headers: NAV_HEADERS, redirect: 'error' });
    const lsd = parseLsdToken(html);
    if (!lsd) throw new Error('meta: could not find LSD token on /jobsearch/ — page markup changed');

    const postJobs = async (docId) => {
      const body = new URLSearchParams({
        lsd,
        fb_api_req_friendly_name: FRIENDLY_NAME,
        doc_id: docId,
        variables: JSON.stringify({ search_input: SEARCH_INPUT }),
      }).toString();
      const json = await ctx.fetchJson(graphqlUrl, {
        method: 'POST',
        redirect: 'error',
        body,
        headers: {
          'user-agent': BROWSER_UA,
          'content-type': 'application/x-www-form-urlencoded',
          accept: '*/*',
          origin: cfg.origin,
          referer: searchUrl,
          'x-fb-lsd': lsd,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
        },
      });
      return extractJobs(json);
    };

    // Happy path: the pinned/default doc_id. A rotated id fails closed, so a
    // null here means "no all_jobs in the response", not "an empty board".
    let rows = null;
    try {
      rows = await postJobs(cfg.docId);
    } catch {
      rows = null;
    }

    // Recovery: re-derive the current doc_id from the page's own JS bundles.
    if (rows === null) {
      let recovered = null;
      for (const url of parseBundleUrls(html).slice(0, MAX_BUNDLES_SCANNED)) {
        let src;
        try {
          src = await ctx.fetchText(url, { headers: { 'user-agent': BROWSER_UA, accept: '*/*' }, redirect: 'error' });
        } catch {
          continue;
        }
        recovered = parseDocId(src);
        if (recovered) break;
      }
      if (!recovered) {
        throw new Error(
          `meta: doc_id ${cfg.docId} rejected and no current id found in page bundles — ` +
            `re-derive ${RELAY_MODULE} and set meta.doc_id in portals.yml`,
        );
      }
      rows = await postJobs(recovered);
      if (rows === null) throw new Error(`meta: GraphQL returned no all_jobs even with recovered doc_id ${recovered}`);
    }

    return rows
      .filter(/** @param {any} j */ (j) => j && j.title && j.id)
      .map(/** @param {any} j */ (j) => ({
        title: String(j.title).trim(),
        url: `${cfg.origin}/jobs/${j.id}/`,
        company: entry.name,
        // Meta lists every eligible office on one posting; join them so the
        // scanner's location_filter can substring-match any of them.
        location: Array.isArray(j.locations) ? [...new Set(j.locations.filter(Boolean))].join('; ') : '',
        // No date field exists in this payload — omit rather than invent.
      }));
  },
};
