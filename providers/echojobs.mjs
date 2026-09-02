// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// EchoJobs provider — RETIRED (#2976, 2026-08-20). The board-wide public JSON
// feed this provider read (https://echojobs.io/api/jobs) no longer serves
// listings: both the feed and its robots.txt now answer with a Vercel
// bot-protection checkpoint (HTTP 429), and the site's own robots.txt
// disallows /api. career-ops does not work around bot protection, so this is
// not a provider to repair — the door is closed on purpose. See
// docs/SUPPORTED_JOB_BOARDS.md for the current state.
//
// fetch() below throws immediately with that explanation rather than making
// a request against the checkpoint and surfacing a confusing raw parse error
// ("expected { jobs: [...] }") to anyone who still has `provider: echojobs`
// configured. detect() is left matching `provider: echojobs` on purpose, so
// that misconfiguration surfaces this clear message instead of a silent
// "no provider matched" — remove the entry from portals.yml once seen.
//
// normalizeEchojobsJob() is kept (and still unit-tested) as a record of the
// feed's shape; it is dead code today since fetch() never reaches it.
//
// Each row's `url` was the ORIGINAL ATS posting (e.g. jobs.ashbyhq.com/…), so
// — unlike the feed host — job URLs were not pinned to echojobs.io; only the
// feed fetch was host-locked.

const FEED_BASE = 'https://echojobs.io/api/jobs';

// The retirement message thrown by fetch() below — also asserted verbatim in
// tests/providers/echojobs.test.mjs, so update both together.
const RETIRED_MESSAGE =
  'echojobs: this feed is gone — echojobs.io/api/jobs is now behind bot protection ' +
  '(HTTP 429, Vercel checkpoint) and the site\'s robots.txt disallows /api (#2976). ' +
  'This provider is retired, not broken-and-fixable: remove `provider: echojobs` from ' +
  'portals.yml. See docs/SUPPORTED_JOB_BOARDS.md.';

// Guards against a doubled marker when the board already spells the work model
// into the location itself ("Berlin (Hybrid)", "Hybrid - London").
const HYBRID_MARKER = /\bhybrid\b/i;

/**
 * Normalize a single EchoJobs feed item. Exported for tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (items without one are dropped).
 *   - url:      `url` — an absolute `https:` posting URL on the company's own ATS
 *               host (NOT echojobs.io), used as the dedup key. Non-https/malformed
 *               URLs drop the item.
 *   - company:  `company_name`, falling back to the portal entry name, then "EchoJobs".
 *   - location: the joined `locations` array, with " · Hybrid" appended when
 *               `remote_type` is hybrid ("Berlin · Hybrid"), and falling back
 *               to a bare "Hybrid" / "Remote" when the posting lists no place
 *               at all. Hybrid is never collapsed into "Remote": the emitted
 *               string is what `location_filter` matches on, so collapsing it
 *               would make a `block: ["Hybrid"]` rule unmatchable and let
 *               hybrid roles pass a remote-only filter (#2258). A placeless
 *               on_site posting keeps "" — only remote/hybrid are
 *               placeless-tolerant, and "" passes the filter under the
 *               scanner's "don't penalize missing data" convention.
 *
 *               Note this diverges from greenhouse.mjs, which treats a
 *               work-model-only location as damage to repair via /offices
 *               enrichment. That provider can recover a real city; this feed
 *               exposes none, so the work model is the only signal there is
 *               and is better surfaced than dropped.
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
  // The feed is a third-party aggregate, so `remote_type` is compared
  // case/whitespace-insensitively: a "Hybrid" variant must not fall through
  // silently and become an unmarked, unfilterable role.
  const remoteType = typeof j.remote_type === 'string' ? j.remote_type.trim().toLowerCase() : '';
  if (remoteType === 'hybrid') {
    // A hybrid role keeps its city AND gains the marker ("Berlin · Hybrid"),
    // same shape as oraclecloud's WorkplaceTypeCode hint. Marking only the
    // placeless ones would leave `block: ["Hybrid"]` half-working: it would
    // catch the placeless roles and silently pass every hybrid that happens
    // to list a city (#2258).
    if (!HYBRID_MARKER.test(location)) location = [location, 'Hybrid'].filter(Boolean).join(' · ');
  } else if (!location && remoteType === 'remote') {
    location = 'Remote';
  }

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

  async fetch() {
    // Deliberately no network call: the feed is confirmed gone (see the file
    // header), and career-ops does not work around bot protection. Throwing
    // immediately, with a message naming the cause, is what turns "expected
    // { jobs: [...] }" into something a user can act on.
    throw new Error(RETIRED_MESSAGE);
  },
};
