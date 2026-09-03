// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ADP Workforce Now Recruitment provider — hits the public, no-auth
// "staffing" event API behind a tenant's recruitment page.
// Auto-detects from careers_url pattern
// `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=...&ccId=...`
//
//   List:   GET {base}/job-requisitions?cid={CID}&ccId={CCID}&$skip=1&$top=20
//   Detail: GET {base}/job-requisitions/{itemID}?cid={CID}&ccId={CCID}&lang=en_US&locale=en_US
//
// where {base} is the fixed literal host
// https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1.
//
// Pagination is a plain row offset, ONE-BASED ($skip=1 is the first page, not
// 0) — advance by the number of rows actually returned each page, not a fixed
// PAGE_SIZE, and stop once the running count reaches the response's own
// `meta.totalNumber` or a page comes back empty (mirrors workday.mjs's own
// "never trust the source's page count alone" discipline, just expressed as a
// running total instead of a page-count ceiling).
//
// ── ID semantics (do not conflate) ──────────────────────────────────────────
// - itemID            ADP's internal resource id (e.g. "9200947568911_1").
//                      Detail-fetch key AND the stable dedup/job.url key.
// - ExternalJobID      The public job number, tucked inside
//                      customFieldGroup.stringFields (an ADP OData-style
//                      name/value list — find the entry whose
//                      nameCode.codeValue === 'ExternalJobID'). Used to build
//                      the public posting URL. Falls back to itemID when
//                      absent — verified live that the fallback still opens a
//                      working posting page.
// - clientRequisitionID  The employer's own req number. Display-only, never
//                      used as an id anywhere in this provider.
//
// The list payload does not carry the full JD (that's `requisitionDescription`
// on the detail response only), so — mirroring smartrecruiters.mjs/vdab.mjs —
// description enrichment is opt-in per tracked_companies entry:
//
//   adpWorkforcenow:
//     fetchDetails: true   # fetch each posting's detail JSON for descriptions
//     detailLimit: 25      # max detail calls per sweep when fetchDetails=true
//
// Rate limiting was observed live but not fully characterized upstream, so
// pagination and detail enrichment both stay conservative: small inter-page
// delay, retry/backoff via the shared helper, sequential (not concurrent)
// detail calls.

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { intInRange } from './_config-utils.mjs';
import { htmlToText } from './_html-to-text.mjs';

const ADP_HOST = 'workforcenow.adp.com';
const API_BASE = `https://${ADP_HOST}/mascsr/default/careercenter/public/events/staffing/v1`;

const PAGE_SIZE = 20; // ADP's fixed page size; $skip advances by rows actually returned, not this constant.

// Safety cap on pagination, independent of what the API reports as
// meta.totalNumber — a tampered/misbehaving response must not turn one
// portals.yml line into an unbounded request loop (ADDING_A_PROVIDER.md,
// "Absolute page ceiling"). Override with max_pages on the entry for a
// tenant that genuinely has more postings than this covers.
const DEFAULT_MAX_PAGES = 100; // 100 * 20 = 2000 postings
const MAX_PAGES_CAP = 1500; // hard ceiling even for an explicit override

// Retry policy for transient page/detail failures (429, 5xx, timeouts/aborts).
// Rate limiting was "observed empirically but not fully characterized" per
// the source issue — the default shared policy (2 retries) is conservative
// enough without inventing tuning this provider has no evidence for.
const RETRY_POLICY = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

// Delay between successive LIST pages within one tenant's pagination loop.
// Same rationale as workday.mjs's INTER_PAGE_DELAY_MS: a burst of same-host
// requests with zero delay risks tripping a rate limiter on any tenant deep
// enough to paginate past page 1.
const INTER_PAGE_DELAY_MS = 250;

const DETAIL_BATCH = 1; // sequential — see fetchDetails below for why.

/**
 * A careers/recruitment page:
 * `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=...&ccId=...`
 * cid/ccId may appear in either order and alongside other query params.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ cid: string, ccId: string } | null}
 */
function resolveTenant(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    if (parsed.hostname.toLowerCase() !== ADP_HOST) continue;
    const cid = parsed.searchParams.get('cid');
    const ccId = parsed.searchParams.get('ccId');
    if (cid && ccId) return { cid, ccId };
  }
  return null;
}

/**
 * @param {string} cid
 * @param {string} ccId
 * @param {number} skip
 */
function buildListUrl(cid, ccId, skip) {
  const u = new URL(`${API_BASE}/job-requisitions`);
  u.searchParams.set('cid', cid);
  u.searchParams.set('ccId', ccId);
  u.searchParams.set('$skip', String(skip));
  u.searchParams.set('$top', String(PAGE_SIZE));
  return u.href;
}

/**
 * @param {string} itemId
 * @param {string} cid
 * @param {string} ccId
 */
function buildDetailUrl(itemId, cid, ccId) {
  const u = new URL(`${API_BASE}/job-requisitions/${encodeSegment(itemId)}`);
  u.searchParams.set('cid', cid);
  u.searchParams.set('ccId', ccId);
  u.searchParams.set('lang', 'en_US');
  u.searchParams.set('locale', 'en_US');
  return u.href;
}

/**
 * `itemID` is host-controlled (it comes back off the API, not out of
 * portals.yml) and becomes a URL path segment here — encodeURIComponent
 * throws a URIError on a lone UTF-16 surrogate, which would otherwise abort
 * an entire batch of detail fetches over one bad record. This codebase's
 * shared `_safe-url.mjs` helper (documented in ADDING_A_PROVIDER.md) isn't
 * present in this checkout, so the same fail-safe behavior — return null,
 * drop just that one job, never throw out of a loop — is reproduced locally.
 * @param {string} s
 * @returns {string | null}
 */
function encodeSegment(s) {
  try {
    return encodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * @param {string} host
 * @param {string} url
 */
function assertAdpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`adp-workforcenow: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`adp-workforcenow: URL must use HTTPS: ${url}`);
  if (parsed.hostname.toLowerCase() !== ADP_HOST) {
    throw new Error(`adp-workforcenow: untrusted hostname "${parsed.hostname}" — must be ${ADP_HOST}`);
  }
  return url;
}

// customFieldGroup is ADP's generic OData-ish name/value list, split by type
// (stringFields, dateFields, ...). Each entry carries nameCode.codeValue as
// the field's logical name and a typed `*Value` payload.
/**
 * @param {any} customFieldGroup
 * @param {string} groupKey e.g. 'stringFields' | 'dateFields'
 * @param {string} codeValue e.g. 'ExternalJobID'
 */
function findCustomField(customFieldGroup, groupKey, codeValue) {
  const list = customFieldGroup?.[groupKey];
  if (!Array.isArray(list)) return null;
  return list.find((f) => f?.nameCode?.codeValue === codeValue) ?? null;
}

/** @param {any} customFieldGroup */
export function extractExternalJobId(customFieldGroup) {
  const field = findCustomField(customFieldGroup, 'stringFields', 'ExternalJobID');
  const v = field?.stringValue;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
/** @param {unknown} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {any} job */
export function extractPostedAt(job) {
  const direct = toEpochMs(job?.postDate);
  if (direct !== undefined) return direct;
  const field = findCustomField(job?.customFieldGroup, 'dateFields', 'PostingDate');
  return toEpochMs(field?.dateValue);
}

// requisitionLocations[].nameCode carries a ready-made label; some tenants
// leave it empty and only populate the structured address instead. Multiple
// work locations are deduped and joined with " / ", same convention as
// csod.mjs / successfactors.mjs.
/** @param {any} job */
export function extractLocation(job) {
  const list = Array.isArray(job?.requisitionLocations) ? job.requisitionLocations : [];
  const out = [];
  for (const loc of list) {
    const nameCode = loc?.nameCode;
    let label = (nameCode?.shortName || nameCode?.longName || '').trim();
    if (!label) {
      const addr = loc?.address;
      const city = (addr?.cityName || '').trim();
      const region = (addr?.countrySubdivisionLevel1?.codeValue || '').trim();
      const country = (addr?.country?.codeValue || '').trim();
      label = [city, region, country].filter(Boolean).join(', ');
    }
    if (label && !out.includes(label)) out.push(label);
  }
  return out.join(' / ');
}

/**
 * Optional, best-effort — never invent a figure absent from the payload.
 * Prefers the structured payGradeRange (mirrors ashby.mjs's `{min, max,
 * currency}` shape, which scan.mjs's salary_filter / formatCompensation
 * already know how to consume); falls back to whatever numbers are literally
 * present in the tagged customFieldGroup strings some tenants use instead —
 * pulling out digits already in the field, not inventing structure it
 * doesn't have. Returns null when neither source is present or usable.
 * @param {any} job
 * @returns {{min: number | null, max: number | null, currency: string} | null}
 */
export function extractSalary(job) {
  const range = job?.payGradeRange;
  const minAmt = range?.minimumRate?.amountValue;
  const maxAmt = range?.maximumRate?.amountValue;
  const min = typeof minAmt === 'number' && Number.isFinite(minAmt) ? minAmt : null;
  const max = typeof maxAmt === 'number' && Number.isFinite(maxAmt) ? maxAmt : null;
  if (min !== null || max !== null) {
    const currency = range?.minimumRate?.currencyCode || range?.maximumRate?.currencyCode || '';
    return { min, max, currency: typeof currency === 'string' ? currency : '' };
  }

  // Fallback: tenant-tagged custom fields carrying a free-text range (e.g.
  // "$50,000 - $70,000"). Extract whatever numbers are present; a single
  // number becomes both min and max, two or more become the low/high of the
  // set (order-independent — some tenants write "up to $X" style strings).
  const salaryRange = findCustomField(job?.customFieldGroup, 'stringFields', 'SalaryRange')?.stringValue;
  const symbolOrCode = findCustomField(job?.customFieldGroup, 'stringFields', 'CurrencySymbolOrCode')?.stringValue;
  if (typeof salaryRange === 'string' && salaryRange.trim()) {
    const nums = (salaryRange.match(/[\d,]+(?:\.\d+)?/g) || [])
      .map((n) => Number(n.replace(/,/g, '')))
      .filter((n) => Number.isFinite(n));
    if (nums.length > 0) {
      return {
        min: Math.min(...nums),
        max: Math.max(...nums),
        currency: typeof symbolOrCode === 'string' ? symbolOrCode.trim() : '',
      };
    }
  }
  return null;
}

/**
 * Canonical public posting URL. Falls back to itemID as `jobId` when
 * ExternalJobID is absent — verified live that this still opens a working
 * posting page.
 * @param {string} cid @param {string} ccId @param {string} itemId @param {string | null} externalJobId
 */
export function buildPostingUrl(cid, ccId, itemId, externalJobId) {
  const jobId = externalJobId || itemId;
  // URLSearchParams performs the query-component encoding. Probe the values
  // with encodeSegment only to retain the lone-surrogate fail-safe; passing
  // its encoded output to URLSearchParams would double-encode `%`.
  if (encodeSegment(jobId) === null || encodeSegment(itemId) === null) return null;
  const u = new URL(`https://${ADP_HOST}/mascsr/default/mdf/recruitment/recruitment.html`);
  u.searchParams.set('cid', cid);
  u.searchParams.set('ccId', ccId);
  u.searchParams.set('lang', 'en_US');
  u.searchParams.set('type', 'JS');
  u.searchParams.set('jobId', jobId);
  u.searchParams.set('jwId', itemId);
  return u.href;
}

/**
 * Parse one `job-requisitions` list-page response into raw job rows.
 *
 * ADP returns `{ jobRequisitions: [...], meta: { totalNumber } }`. A row
 * missing a usable `itemID` or title is dropped (both required — itemID is
 * the dedup/detail key, and a blank job.url would collapse distinct postings
 * — same discipline as bamboohr.mjs's id/name filter).
 *
 * @param {any} json
 * @param {{ cid: string, ccId: string, companyName: string }} cfg
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, postedAt?: number}>, total: number | null, raw: any[] }}
 */
export function parseListPage(json, cfg) {
  const raw = Array.isArray(json?.jobRequisitions) ? json.jobRequisitions : [];
  const total = typeof json?.meta?.totalNumber === 'number' ? json.meta.totalNumber : null;
  const jobs = [];
  for (const job of raw) {
    if (!job || typeof job !== 'object') continue;
    const itemId = typeof job.itemID === 'string' ? job.itemID.trim() : '';
    const title = typeof job.requisitionTitle === 'string' ? job.requisitionTitle.trim() : '';
    if (!itemId || !title) continue;
    const externalJobId = extractExternalJobId(job.customFieldGroup);
    const url = buildPostingUrl(cfg.cid, cfg.ccId, itemId, externalJobId);
    if (!url) continue; // a lone-surrogate id — drop just this one posting
    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const row = {
      title,
      url,
      company: cfg.companyName,
      location: extractLocation(job),
    };
    const postedAt = extractPostedAt(job);
    if (postedAt !== undefined) row.postedAt = postedAt;
    const salary = extractSalary(job);
    if (salary) row.salary = salary;
    const employmentType = job?.workLevelCode?.shortName;
    if (typeof employmentType === 'string' && employmentType.trim()) row.employmentType = employmentType.trim();
    jobs.push(Object.assign(row, { _itemId: itemId }));
  }
  return { jobs, total, raw };
}

/** @param {any} entry */
function parseAdpConfig(entry) {
  const cfg = (entry && entry.adpWorkforcenow) || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'adp-workforcenow',

  detect(entry) {
    const tenant = resolveTenant(entry);
    return tenant ? { url: buildListUrl(tenant.cid, tenant.ccId, 1) } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`adp-workforcenow: cannot derive cid/ccId for ${entry.name}`);
    const { cid, ccId } = tenant;
    const cfg = { cid, ccId, companyName: entry.name };

    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets ctx.maxPages — cooperate the same
    // way workday.mjs/smartrecruiters.mjs do, so the probe costs one request.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageLimit = Math.min(maxPages, ctxCap);

    const jobs = [];
    const seen = new Set();
    let skip = 1; // ADP's $skip is one-based.
    let total = null;

    for (let page = 0; page < pageLimit; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const listUrl = assertAdpUrl(buildListUrl(cid, ccId, skip));
      const json = await fetchJsonWithRetry(ctx, listUrl, { redirect: 'error' }, RETRY_POLICY);

      // The endpoint documents a `jobRequisitions` array — a response that
      // has neither that array nor a `meta` object at all is not "zero
      // postings", it's a shape we don't recognize (surface it loudly rather
      // than silently reporting an empty board forever).
      if (json && typeof json === 'object' && !Array.isArray(json.jobRequisitions) && json.meta === undefined) {
        throw new Error(`adp-workforcenow: unrecognized job-requisitions response for ${entry.name} — keys: ${Object.keys(json).join(', ') || '(none)'}`);
      }

      const { jobs: pageJobs, total: pageTotal, raw } = parseListPage(json, cfg);
      if (pageTotal !== null) total = pageTotal;

      // An empty page — whether "no rows at all" or "every row on this page
      // was unusable" — is the pagination stop condition either way; a
      // response that never advances would otherwise loop until pageLimit.
      if (raw.length === 0) break;

      let fresh = 0;
      for (const job of pageJobs) {
        const { _itemId, ...clean } = /** @type {any} */ (job);
        if (seen.has(_itemId)) continue;
        seen.add(_itemId);
        fresh++;
        jobs.push(Object.assign(clean, { _itemId }));
      }
      // No new ids this page → server ignored $skip (or we've looped). Stop,
      // same guard bamboohr/csod/successfactors all use.
      if (fresh === 0) break;

      skip += raw.length; // advance by rows actually returned, never PAGE_SIZE
      if (total !== null && jobs.length >= total) break;
    }

    // Detail enrichment answers "what does this job say", not "is this
    // endpoint alive" — skip it entirely while a health probe is running
    // (ctx.maxPages set), same rule as smartrecruiters.mjs/vdab.mjs.
    const { fetchDetails, detailLimit } = parseAdpConfig(entry);
    const probing = ctxCap !== Infinity;
    if (fetchDetails && !probing) {
      const targets = jobs.slice(0, detailLimit);
      // Sequential, not batched/concurrent: rate limiting on this API "was
      // observed empirically but not fully characterized" per the source
      // issue, so this stays as conservative as the spec's own
      // "1 per tenant" starting suggestion until real data says otherwise.
      for (let i = 0; i < targets.length; i += DETAIL_BATCH) {
        const job = /** @type {any} */ (targets[i]);
        await sleep(INTER_PAGE_DELAY_MS, ctx);
        try {
          const detailUrl = assertAdpUrl(buildDetailUrl(job._itemId, cid, ccId));
          const detail = await fetchJsonWithRetry(ctx, detailUrl, { redirect: 'error' }, RETRY_POLICY);
          const description = htmlToText(detail?.requisitionDescription);
          if (description) job.description = description;
        } catch {
          // Detail fetch is an enrichment only — keep the listing result
          // (same fail-open contract as smartrecruiters.mjs).
        }
      }
    }

    // _itemId drove dedup/detail lookups above; it's internal plumbing and
    // must not leak into the pipeline's Job rows (mirrors smartrecruiters.mjs).
    return jobs.map(({ _itemId, ...job }) => job);
  },
};
