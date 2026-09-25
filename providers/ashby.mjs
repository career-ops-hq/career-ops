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
import { fetchJsonWithRetry, fetchTextWithRetry } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

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

const EMBED_HOST = 'jobs.ashbyhq.com';

/** Same pin as the posting API, for the other host this provider may read. */
function assertEmbedUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`ashby: invalid embed URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new Error(`ashby: embed URL must use HTTPS: ${url}`);
  if (parsed.hostname !== EMBED_HOST) throw new Error(`ashby: untrusted embed hostname "${parsed.hostname}" — must be ${EMBED_HOST}`);
  return url;
}

/**
 * Resolve the board slug for the embed source.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string|null}
 */
function resolveBoardSlug(entry) {
  const explicit = /** @type {any} */ (entry).ashby?.board;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const match = (entry.careers_url || '').match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * The embed page Ashby's own documented embed script loads.
 *
 * `<script src="https://jobs.ashbyhq.com/{slug}/embed?version=2">` builds its
 * iframe with `urlForIframe.searchParams.set("embed", "js")` ("This will always
 * be set"), so this is the same server-rendered page every careers site that
 * embeds an Ashby board already requests. robots.txt on jobs.ashbyhq.com
 * disallows only /meeting/, /b/ and /api/.
 *
 * @param {string} slug
 * @returns {string}
 */
export function buildEmbedUrl(slug) {
  return `https://${EMBED_HOST}/${encodeURIComponent(slug)}?embed=js`;
}

// The embed page hydrates from a single assignment. Capturing to the closing
// `};` of the object literal keeps the match anchored on the shape rather than
// on surrounding markup.
const APP_DATA_RE = /window\.__appData\s*=\s*(\{[\s\S]*?\});/;

/**
 * Pull the job board out of the embed page.
 *
 * Three outcomes, deliberately distinct — a company that disabled its posting
 * API and a slug that does not exist BOTH answer 404 on the API, and only this
 * page tells them apart:
 *   - a jobBoard object        -> the board exists and is readable
 *   - jobBoard: null           -> no such board (a nonexistent slug renders
 *                                 `"organization":null,"jobBoard":null`)
 *   - no parseable __appData   -> Ashby changed the page
 *
 * @param {string} html
 * @returns {{jobPostings: any[]} | null} null when jobBoard is absent/null.
 * @throws when __appData itself cannot be found or parsed.
 */
export function parseEmbedAppData(html) {
  const m = APP_DATA_RE.exec(html || '');
  if (!m) throw new Error('ashby: embed page carried no window.__appData — Ashby changed the embed markup');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('ashby: embed page __appData did not parse as JSON — Ashby changed the embed markup');
  }
  const board = data?.jobBoard;
  if (!board || typeof board !== 'object') return null;
  if (!Array.isArray(board.jobPostings)) {
    throw new Error('ashby: embed jobBoard carried no jobPostings array — Ashby changed the embed payload');
  }
  return { jobPostings: board.jobPostings };
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

/**
 * Read a board from the embed page instead of the posting API.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @param {import('./_types.js').Context} ctx
 * @returns {Promise<import('./_types.js').Job[]>}
 */
async function fetchFromEmbed(entry, ctx) {
  const slug = resolveBoardSlug(entry);
  if (!slug) throw new Error(`ashby: cannot derive the board slug for ${entry.name} — set ashby.board or a jobs.ashbyhq.com careers_url`);
  const url = buildEmbedUrl(slug);
  assertEmbedUrl(url);
  const html = /** @type {string} */ (await fetchTextWithRetry(
    ctx,
    url,
    { timeoutMs: ASHBY_TIMEOUT_MS, redirect: 'error' },
    { retries: ASHBY_RETRIES, baseDelayMs: ASHBY_BACKOFF_BASE_MS },
  ));
  const board = parseEmbedAppData(html);
  if (!board) {
    // The page rendered, and it says there is no such board. That is the same
    // condition the posting API reports as 404, and it has to stay loud: a
    // mistyped or migrated slug returning [] would read as "no open roles"
    // on every scan from here on.
    const err = new Error(`ashby: no job board at ${url} — the slug does not exist (jobBoard: null)`);
    /** @type {any} */ (err).status = 404;
    throw err;
  }
  const encodedSlug = safeEncodeURIComponent(slug);
  if (encodedSlug === null) throw new Error(`ashby: board slug for ${entry.name} cannot be URI-encoded`);
  return board.jobPostings.map((/** @type {any} */ p) => {
    // A row the payload mangled is dropped on its own, never the board: a null
    // entry, or one with no usable id. The id is the URL's last segment, so
    // without it `String(undefined)` minted ".../undefined" — a dead link that
    // passed the title/url filter (CodeRabbit, #4298). The URL and externalId
    // now come from the same coerced value.
    if (!p || typeof p !== 'object') return null;
    const id = coerceId(p.id);
    if (id === undefined) return null;
    // Same location rendering as the posting API path, so a board reads the
    // same whichever source served it — in particular the "Remote" marker:
    // scan.mjs's location_filter sees only this string, so a remote posting
    // whose locationName is a city would otherwise fail `allow: ["Remote"]`
    // (CodeRabbit, #4298). The embed payload names places `locationName`
    // where the API says `location`; nothing else differs.
    const location = formatLocation({
      location: p.locationName,
      secondaryLocations: Array.isArray(p.secondaryLocations)
        ? p.secondaryLocations.map((/** @type {any} */ l) => ({ location: l?.locationName }))
        : [],
      workplaceType: p.workplaceType,
      isRemote: p.isRemote,
    });
    // The id comes from the embed payload, so it is host-controlled: a lone
    // surrogate in it would make encodeURIComponent throw and take the whole
    // board down mid-map. Drop that one posting instead (_safe-url.mjs).
    const encodedId = safeEncodeURIComponent(id);
    return {
      title: p.title || '',
      url: encodedId === null ? '' : `https://${EMBED_HOST}/${encodedSlug}/${encodedId}`,
      company: entry.name,
      externalId: id,
      location,
      // The embed payload carries neither descriptionPlain nor publishedAt —
      // the posting API's two extras. An absent date means "unknown", never
      // "stale", so nothing is invented here.
      ...(p.workplaceType ? { workplaceType: String(p.workplaceType) } : {}),
    };
  }).filter((/** @type {any} */ j) => j && j.title && j.url);
}

/** @type {Provider} */
export default {
  id: 'ashby',

  detect(entry) {
    try {
      // An opted-in embed entry is Ashby's even when careers_url is a corporate
      // page: `ashby.board` names the board then, and without this branch an
      // entry with no explicit `provider:` never reached the embed source
      // (CodeRabbit, #4298). The URL is the one fetch() will actually read.
      if (/** @type {any} */ (entry).ashby?.embed) {
        const slug = resolveBoardSlug(entry);
        if (slug) return { url: buildEmbedUrl(slug) };
      }
      const apiUrl = resolveApiUrl(entry);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    // Opt-in embed source. Some companies turn the public posting API off while
    // their board stays published: api.ashbyhq.com answers 404, and the board is
    // still served to every careers page that embeds it. `ashby: { embed: true }`
    // reads that page instead.
    //
    // Opt-in rather than an automatic 404 fallback, on measurement: of 460
    // boards sampled from the sweep dataset, 107 answered 404 and exactly ONE
    // was an API-disabled live board. An automatic fallback would spend a second
    // request on every dead board in every sweep (#2840 counted 684 of them) to
    // recover ~1%, and would turn a mistyped slug from a loud error into a
    // silent empty board.
    if (/** @type {any} */ (entry).ashby?.embed) {
      return await fetchFromEmbed(entry, ctx);
    }
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
