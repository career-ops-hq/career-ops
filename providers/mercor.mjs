// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { fetchTextWithRetry } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Mercor provider — the public expert/contract listings on Mercor's own work
// marketplace, https://work.mercor.com/explore (work.mercor.com/jobs 308s
// there). This is a different inventory from Mercor's corporate Ashby board
// (jobs.ashbyhq.com/mercor, already read by the ashby provider): the explore
// page carries the AI-training / evaluation contracts Mercor staffs.
//
// The page is server-rendered Next.js: every public listing arrives in
// `__NEXT_DATA__` → props.pageProps.dehydratedState.queries[*].state.data
// .listings, one request, no pagination (315 listings observed 2026-10-28;
// `?page=` is ignored). robots.txt (checked 2026-10-28) under
// `User-agent: *` allows `/` and disallows /api/, /apply/, /jobs/apply/ and
// account routes — not /explore, which is the only path read here, and not
// /jobs/{id}, the posting URL handed to the user.
//
// Company is "Mercor": Mercor is the contracting party on every listing. The
// `companyName` field is the client project as Mercor chooses to show it —
// mostly codenames ("Neon", "Boron") or null — so it goes into description,
// never into `company`. Location is copied as stated; when the listing names
// eligible countries (`eligibleLocation`), they are appended. A bare
// "Remote" with no eligibility list is left as "Remote", never widened.
// Pay is hourly / per task, so it goes into description, never `salary`.
//
// Job URL: https://work.mercor.com/jobs/{listingId}. The site 308s that to a
// title-slug URL; the bare id is used because it stays stable when a listing
// is retitled, so the dedup key does not churn.
//
// Wire in via a `job_boards:` entry with `provider: mercor`.

const ORIGIN = 'https://work.mercor.com';
const EXPLORE_URL = `${ORIGIN}/explore`;

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Mercor timestamps are ISO without an offset ("2026-10-28T10:14:25"); read
// them as UTC rather than the scanning machine's local zone.
/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const ARRANGEMENT_LABELS = /** @type {Record<string, string>} */ ({
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
});

// "United States (Remote)" already states eligibleLocation ["USA"]; don't
// repeat it. Only the US spellings are folded; any other code is compared
// literally.
const US_RE = /\b(usa|us|u\.s\.|united states)\b/i;
/** @param {string} base @param {string} country */
function alreadyNamed(base, country) {
  if (US_RE.test(country)) return US_RE.test(base);
  return base.toLowerCase().includes(country.toLowerCase());
}

/** @param {any} row */
function resolveLocation(row) {
  const base = str(row.location) || ARRANGEMENT_LABELS[str(row.workArrangement).toLowerCase()] || '';
  const eligible = Array.isArray(row.eligibleLocation)
    ? row.eligibleLocation.map(str).filter(Boolean)
    : [];
  if (!eligible.length) return base;
  const missing = eligible.filter(e => !alreadyNamed(base, e));
  if (!missing.length) return base;
  return base ? `${base} (eligible: ${eligible.join(', ')})` : `Eligible: ${eligible.join(', ')}`;
}

/** @param {any} row */
function rateText(row) {
  const min = Number.isFinite(row.rateMin) ? row.rateMin : undefined;
  const max = Number.isFinite(row.rateMax) ? row.rateMax : undefined;
  if (min === undefined && max === undefined) return '';
  const range = min !== undefined && max !== undefined && min !== max
    ? `$${min}-${max}`
    : `$${min ?? max}`;
  const freq = str(row.payRateFrequency);
  return freq ? `${range} (${freq})` : range;
}

/**
 * Normalize one explore-page listing. Returns null for a malformed,
 * non-active, private or deleted listing. Exported for unit tests.
 *
 * @param {any} row
 */
export function normalizeMercorListing(row) {
  if (!row || typeof row !== 'object') return null;
  const id = str(row.listingId);
  const title = str(row.title);
  if (!id || !title) return null;
  if (row.status != null && row.status !== 'active') return null;
  if (row.isPrivate === true || row.deletedAt) return null;
  const seg = safeEncodeURIComponent(id);
  if (seg === null) return null;

  const client = row.companyBrandVisible === true ? str(row.companyName) : '';
  const rate = rateText(row);
  const description = [
    str(row.description),
    client && `Client project: ${client}`,
    str(row.commitment) && `Commitment: ${str(row.commitment)}`,
    rate && `Rate: ${rate}`,
  ].filter(Boolean).join('\n');

  /** @type {import('./_types.js').Job} */
  const job = {
    title,
    url: `${ORIGIN}/jobs/${seg}`,
    company: 'Mercor',
    location: resolveLocation(row),
    externalId: id,
  };
  const postedAt = toEpochMs(row.postedAt) ?? toEpochMs(row.createdAt);
  if (postedAt !== undefined) job.postedAt = postedAt;
  if (description) job.description = description;
  return job;
}

/**
 * Parse the explore page HTML. Throws when `__NEXT_DATA__` or the listings
 * array is missing (a markup change); a present-and-empty listings array is
 * an empty board. Exported for unit tests.
 *
 * @param {unknown} html
 * @returns {import('./_types.js').Job[]}
 */
export function parseMercorExplorePage(html) {
  if (typeof html !== 'string' || !html) throw new Error('mercor: empty or non-string explore page body');
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('mercor: explore page has no __NEXT_DATA__ blob');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`mercor: __NEXT_DATA__ is not valid JSON (${/** @type {Error} */ (err).message})`);
  }
  const queries = data?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) throw new Error('mercor: __NEXT_DATA__ has no dehydratedState.queries[]');
  const holder = queries.find(q => q && q.state && q.state.data && typeof q.state.data === 'object' && 'listings' in q.state.data);
  const rows = holder ? holder.state.data.listings : undefined;
  if (!Array.isArray(rows)) {
    throw new Error(`mercor: expected a listings[] query in __NEXT_DATA__, got ${holder ? typeof rows : `${queries.length} queries without listings`}`);
  }
  /** @type {Map<string, import('./_types.js').Job>} */
  const jobs = new Map();
  for (const row of rows) {
    const job = normalizeMercorListing(row);
    if (job && !jobs.has(job.url)) jobs.set(job.url, job);
  }
  return [...jobs.values()];
}

/** @type {Provider} */
export default {
  id: 'mercor',

  detect(entry) {
    return entry?.provider === 'mercor' ? { url: EXPLORE_URL } : null;
  },

  async fetch(_entry, ctx) {
    // One request carries the whole inventory, so ctx.maxPages: 1 is already
    // satisfied; a fetch rejection propagates unwrapped.
    const html = await fetchTextWithRetry(ctx, EXPLORE_URL, { redirect: 'error', timeoutMs: 30_000 });
    return parseMercorExplorePage(html);
  },
};
