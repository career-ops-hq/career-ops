// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Ashby provider — hits the public posting-api endpoint.
// Auto-detects from careers_url pattern `https://jobs.ashbyhq.com/<slug>`.
//
// Ashby's public posting-api carries a ~10s+ server-side latency floor
// (response time is independent of board size) and rate-limits repeated
// unauthenticated hits. The global default timeout (10s, providers/_http.mjs)
// sits right on that floor, so requests race the timeout and abort. We give
// Ashby a longer timeout plus a backoff+jitter retry (the backoff spaces
// requests out to dodge rate-limiting).
// See .planning/codebase/ashby-scan-abort-diagnosis.md.
import { fetchJsonWithRetry } from './_http.mjs';

const ASHBY_TIMEOUT_MS = 30_000;
const ASHBY_RETRIES = 2;
const ASHBY_BACKOFF_BASE_MS = 1_000;

// Annualization multipliers for different compensation intervals
const INTERVAL_MULTIPLIERS = {
  '1 HOUR': 2080,
  '1 DAY': 260,
  '1 WEEK': 52,
  '2 WEEK': 26,
  '0.5 MONTH': 24,
  '1 MONTH': 12,
  '2 MONTH': 6,
  '3 MONTH': 4,
  '6 MONTH': 2,
  '1 YEAR': 1,
};

/**
 * Parse compensation data from Ashby job object.
 * Returns structured salary object with min, max, and currency,
 * or null if no valid compensation data exists.
 * @param {any} job - Ashby job object
 * @returns {{min: number, max: number, currency: string}|null}
 */
export function parseCompensation(job) {
  const comp = job?.compensation;
  if (!comp) return null;

  const interval = /** @type {keyof typeof INTERVAL_MULTIPLIERS} */ (comp.interval || '1 YEAR');
  const multiplier = INTERVAL_MULTIPLIERS[interval];
  if (!multiplier) return null;

  // Coerce and validate numeric fields — malformed API payloads must not propagate
  /** @param {any} v */
  const normalizeNum = (v) => {
    if (v == null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const minValue = normalizeNum(comp.minValue);
  const maxValue = normalizeNum(comp.maxValue);
  const currency = typeof comp.currency === 'string' ? comp.currency.trim() : '';

  // If neither min nor max is provided, no valid compensation
  if (minValue == null && maxValue == null) return null;

  // Annualize the values
  const min = minValue != null ? minValue * multiplier : null;
  const max = maxValue != null ? maxValue * multiplier : null;

  // Must have at least one valid annual value
  if (min == null && max == null) return null;

  // Ensure correct ordering (min <= max)
  const resolvedMin = /** @type {number} */ (min ?? max);
  const resolvedMax = /** @type {number} */ (max ?? min);
  return {
    min: Math.min(resolvedMin, resolvedMax),
    max: Math.max(resolvedMin, resolvedMax),
    currency: currency.toUpperCase(),
  };
}

const ALLOWED_ASHBY_HOSTS = new Set(['api.ashbyhq.com']);

/** @param {string} url */
function assertAshbyUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`ashby: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`ashby: URL must use HTTPS: ${url}`);
  if (!ALLOWED_ASHBY_HOSTS.has(parsed.hostname))
    throw new Error(`ashby: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_ASHBY_HOSTS].join(', ')}`);
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  // Explicit api: wins — lets an entry keep a human-facing corporate
  // careers_url (e.g. https://openai.com/careers) while still pinning the
  // Ashby posting-api board (mirrors greenhouse's api: precedence).
  if (entry.api) {
    assertAshbyUrl(entry.api);
    return entry.api;
  }
  const url = entry.careers_url || '';
  const match = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (!match) return null;
  return `https://api.ashbyhq.com/posting-api/job-board/${match[1]}?includeCompensation=true`;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Build the full location string from primary + secondary locations.
// Ashby's posting-api puts extra hiring regions in `secondaryLocations[]`
// (each with a region label + a postalAddress). Using only `j.location` drops
// them, so an EU-eligible role whose PRIMARY label is e.g. "Canada" reads as
// Canada-only and gets wrongly removed by scan.mjs's location_filter. We fold
// in each secondary's region, locality, and country so the filter can match
// (e.g. "Europe", "Berlin", "Germany"). Deduped, joined with " · ".
// Remote work model: Ashby's posting-api exposes `workplaceType`
// ("Remote" | "Hybrid" | "Onsite") and `isRemote` (boolean) as fields SEPARATE
// from `location`, which keeps naming the office/HQ city even for a fully
// remote role. Folding only the location strings therefore renders a remote
// posting as e.g. "San Francisco", and a `location_filter` that blocks that
// city drops a role the candidate could actually take. Appending "Remote"
// makes the work model visible to scan.mjs's string matching without
// discarding the city, so both `allow: ["Remote"]` and city-based filters keep
// working.
//
// `workplaceType` wins whenever it is present: the two fields can disagree, and
// boards in the wild carry `isRemote: true` together with
// `workplaceType: "Hybrid"` for office-anchored roles. Trusting `isRemote`
// alone would label those "Remote" and defeat a remote-only filter. `isRemote`
// remains the fallback for payloads that omit `workplaceType`.
//
// Mirrors existing behavior in bamboohr.mjs, gem.mjs, and thehub.mjs, which
// already append "Remote" from their own providers' remote flags.
/** @param {any} j */
function formatLocation(j) {
  const parts = [];
  if (typeof j.location === 'string' && j.location.trim()) parts.push(j.location.trim());
  if (Array.isArray(j.secondaryLocations)) {
    for (const s of j.secondaryLocations) {
      if (!s || typeof s !== 'object') continue;
      if (typeof s.location === 'string' && s.location.trim()) parts.push(s.location.trim());
      const pa = s.address && s.address.postalAddress;
      if (pa) {
        for (const k of ['addressLocality', 'addressCountry']) {
          if (typeof pa[k] === 'string' && pa[k].trim()) parts.push(pa[k].trim());
        }
      }
    }
  }
  const wt = typeof j.workplaceType === 'string' ? j.workplaceType.trim().toLowerCase() : '';
  const isRemote = wt ? wt === 'remote' : j.isRemote === true;
  if (isRemote && !parts.some((p) => /remote/i.test(p))) parts.push('Remote');
  return [...new Set(parts)].join(' · ');
}

/** @type {Provider} */
export default {
  id: 'ashby',

  detect(entry) {
    try {
      const apiUrl = resolveApiUrl(entry);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`ashby: cannot derive API URL for ${entry.name}`);
    assertAshbyUrl(apiUrl);
    // Shared retry rather than a local loop (#3072). The local one caught
    // EVERY error, so a board that is gone was asked three times: 404, 401 and
    // 410 each bought a second and third request that could only fail again.
    // withRetry stops on the first non-retryable status via isRetryableError,
    // and 22% of Ashby boards are permanently 404 (#2840) — re-probing those
    // is the traffic that provokes the single-host throttle in #2839.
    //
    // It also honours Ashby's own Retry-After on a 429, which the local
    // backoff discarded, while CLAMPING it so a misconfigured
    // `Retry-After: 86400` cannot stall a sweep.
    //
    // ASHBY_RETRIES is passed through as the policy, so the attempt budget is
    // unchanged — only which errors are worth spending it on. The longer
    // per-request timeout above still applies: it is the Ashby latency floor
    // this provider was given a bespoke timeout for, and it travels as `opts`.
    const json = /** @type {any} */ (await fetchJsonWithRetry(
      ctx,
      apiUrl,
      { timeoutMs: ASHBY_TIMEOUT_MS, redirect: 'error' },
      // baseDelayMs is ashby's own 1000ms, not the shared 500ms default. The
      // longer backoff is deliberate here — see the header: Ashby rate-limits
      // repeated unauthenticated hits, and spacing requests out is why this
      // provider had a bespoke loop at all. Only WHICH errors are retried
      // changes; the timing is preserved.
      { retries: ASHBY_RETRIES, baseDelayMs: ASHBY_BACKOFF_BASE_MS },
    ));
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs.map(/** @param {any} j */ (j) => ({
      title: j.title || '',
      url: j.jobUrl || '',
      company: entry.name,
      location: formatLocation(j),
      salary: parseCompensation(j),
      postedAt: toEpochMs(j.publishedAt),
    }));
  },
};
