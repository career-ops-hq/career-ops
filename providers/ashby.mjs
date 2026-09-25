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
import { coerceId } from './_ids.mjs';

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
 *
 * Ashby's posting-api does not put min/max on the compensation object itself.
 * A real payload carries tiers, and each tier carries components:
 *
 *   compensationTiers[].components[] = {
 *     compensationType: 'Salary', interval: '1 YEAR',
 *     minValue, maxValue, currencyCode, summary
 *   }
 *
 * The salary component is the one with min/max; `EquityPercentage` and bonus
 * components carry `summary` text instead and must not be read as a range.
 * The flat shape is still accepted because the existing fixtures and any
 * hand-built job object use it.
 *
 * @param {any} job - Ashby job object
 * @returns {{min: number, max: number, currency: string}|null}
 */
export function parseCompensation(job) {
  const comp = job?.compensation;
  if (!comp) return null;

  /** @param {any} v */
  const normalizeNum = (v) => {
    if (v == null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // A real payload nests the numbers under tiers[].components[]; the flat shape
  // puts them on `comp` directly.
  let source = comp;
  let nested = false;
  /** @type {any[]} */
  const components = (Array.isArray(comp.compensationTiers) ? comp.compensationTiers : [])
    .flatMap((tier) => (Array.isArray(tier?.components) ? tier.components : []));
  if (components.length) {
    // Only a Salary component carries the role's range. An EquityPercentage or
    // bonus component may still hold a number, and reading it as salary would
    // report a percentage or a one-off as an annual figure.
    const salaryComponents = components.filter(
      (c) => String(c?.compensationType ?? '').toLowerCase() === 'salary',
    );
    if (!salaryComponents.length) return null;
    const withRange = salaryComponents.filter(
      (c) => normalizeNum(c?.minValue) != null || normalizeNum(c?.maxValue) != null,
    );
    if (!withRange.length) return null;
    // A board can post several salary components; the widest range is the role's
    // band, and the others are usually a narrower sub-tier of the same posting.
    //
    // Choose among the components that can actually be read, not among all of
    // them. Picking the widest first and validating its interval afterwards made
    // a wider component with an unusable interval fatal: the function returned
    // null instead of falling through to a narrower component that parses, in
    // either array order.
    //
    // A missing interval is unusable here, not merely unvalidated. The nested
    // branch refuses a component with no interval of its own rather than
    // annualizing it, so admitting one as a candidate only lets it win the width
    // contest and then fail that check, which returns null with a readable
    // narrower component sitting right there. That is the same masking failure
    // this filter exists to prevent, one field over.
    const readable = (c) => {
      const raw = c?.interval;
      return typeof raw === 'string'
        && raw.trim() !== ''
        && Object.hasOwn(INTERVAL_MULTIPLIERS, raw);
    };
    const candidates = withRange.filter(readable);
    if (!candidates.length) return null;
    source = candidates.reduce((best, c) => {
      const span = (normalizeNum(c?.maxValue) ?? normalizeNum(c?.minValue) ?? 0)
        - (normalizeNum(c?.minValue) ?? normalizeNum(c?.maxValue) ?? 0);
      const bestSpan = (normalizeNum(best?.maxValue) ?? normalizeNum(best?.minValue) ?? 0)
        - (normalizeNum(best?.minValue) ?? normalizeNum(best?.maxValue) ?? 0);
      return span > bestSpan ? c : best;
    }, candidates[0]);
    nested = true;
  }

  // A component states its own interval, so a nested component with none is not
  // the same as a flat object with none. The `1 YEAR` default is a convenience
  // for the legacy flat shape; applying it here would annualize a monthly figure
  // and present it as a salary with nothing signalling the substitution.
  const rawInterval = nested ? source.interval : (source.interval || comp.interval || '1 YEAR');
  if (typeof rawInterval !== 'string' || !rawInterval.trim()) return null;
  const interval = /** @type {keyof typeof INTERVAL_MULTIPLIERS} */ (rawInterval);
  const multiplier = INTERVAL_MULTIPLIERS[interval];
  if (!multiplier) return null;

  // Coerce and validate numeric fields — malformed API payloads must not propagate
  const minValue = normalizeNum(source.minValue ?? comp.minValue);
  const maxValue = normalizeNum(source.maxValue ?? comp.maxValue);
  const rawCurrency = source.currencyCode ?? source.currency ?? comp.currency;
  const currency = typeof rawCurrency === 'string' ? rawCurrency.trim() : '';

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
      // Ashby's posting uuid — the only stable id this board API exposes
      // (no separate employer requisition field), so requisitionId is left unset
      // rather than guessed at.
      externalId: coerceId(j.id),
      location: formatLocation(j),
      // Ashby's posting-api list ships `descriptionPlain` for free (same
      // payload, no per-job request) — mirrors lever. Enables scan.mjs's
      // content_filter / visa_filter.
      description: typeof j.descriptionPlain === 'string' ? j.descriptionPlain : '',
      salary: parseCompensation(j),
      postedAt: toEpochMs(j.publishedAt),
    }));
  },
};
