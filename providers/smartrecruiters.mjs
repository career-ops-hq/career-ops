// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SmartRecruiters provider — hits the public postings API.
// Auto-detects from careers_url pattern
// `https://(careers|jobs).smartrecruiters.com/<slug>`. A tracked_companies
// entry can also set `provider: smartrecruiters` explicitly to bypass
// detection (useful when the public careers URL is a branded custom domain).
//
// The list payload carries NO description body. Boards that need it opt in
// via tracked_companies config (mirrors vdab):
//
//   smartrecruiters:
//     fetchDetails: true   # fetch each posting's detail JSON for descriptions
//     detailLimit: 25      # max detail calls per sweep when fetchDetails=true
//
// Detail enrichment answers "what does this job say", not "is this endpoint
// alive" — it is skipped entirely while verify-portals is probing, and runs
// in small batches so a 400-posting board cannot hammer the shared API host.
//
// The walk reads 100 postings a page and stops at 50 pages (5,000 postings).
// A board past that is reported as cut short, on stderr and in the canonical
// `truncated` tag scan.mjs reads, and an entry can raise the cap, up to
// SR_HARD_MAX_PAGES:
//
//   max_pages: 60        # a 6,000-posting walk

import { intInRange } from './_config-utils.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const ALLOWED_SMARTRECRUITERS_HOSTS = new Set(['api.smartrecruiters.com']);
const SR_CAREERS_HOSTS = new Set(['careers.smartrecruiters.com', 'jobs.smartrecruiters.com']);
const SR_PAGE_SIZE = 100;
const SR_MAX_PAGES = 50;  // default cap (5000 postings @ 100/page) when the entry sets no max_pages
// Upper bound an entry may opt in to with `max_pages` (10,000 postings). Bosch
// alone listed 5,104 on 2026-11-10, past the default; the bound stays finite so
// a typo can't walk a board forever.
export const SR_HARD_MAX_PAGES = 100;
const SR_DETAIL_BATCH = 5;

/**
 * Page cap for an entry: a positive integer `max_pages` up to
 * SR_HARD_MAX_PAGES, else the default. Exported for unit tests.
 * @param {{max_pages?: unknown}} entry
 */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  return Number.isInteger(v) && /** @type {number} */ (v) > 0
    ? Math.min(/** @type {number} */ (v), SR_HARD_MAX_PAGES)
    : SR_MAX_PAGES;
}

// NaN-safe Date.parse, as in greenhouse.mjs and ashby.mjs, but strings only:
// Date.parse on an object whose toString is not callable throws, and one bad
// row must not abort the whole board.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * @param {any} entry
 * @returns {{ fetchDetails: boolean, detailLimit: number }}
 */
function parseSmartRecruitersConfig(entry) {
  const cfg = (entry && entry.smartrecruiters) || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/**
 * Extracts the best plain-text description from a posting-detail response.
 *
 * The detail payload nests HTML bodies under `jobAd.sections`, keyed by a
 * fixed section set (companyDescription, jobDescription, qualifications,
 * additionalInformation). Joined in that order — company context first,
 * call-to-action last — then stripped by the shared pipeline.
 *
 * @param {any} detail
 * @returns {string}
 */
export function extractDescription(detail) {
  const sections = detail?.jobAd?.sections;
  if (!sections || typeof sections !== 'object') return '';
  const parts = [];
  for (const key of ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']) {
    const text = sections[key]?.text;
    if (typeof text === 'string' && text.trim()) parts.push(text);
  }
  if (parts.length === 0) return '';
  return htmlToText(parts.join('\n'));
}

function assertSmartRecruitersUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`smartrecruiters: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`smartrecruiters: URL must use HTTPS: ${url}`);
  if (!ALLOWED_SMARTRECRUITERS_HOSTS.has(parsed.hostname)) {
    throw new Error(`smartrecruiters: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_SMARTRECRUITERS_HOSTS].join(', ')}`);
  }
  return url;
}

function resolveSlug(entry) {
  // entry.api takes precedence over careers_url (mirrors greenhouse/ashby) so a
  // branded page (e.g. https://jobs.continental.com) can stay as careers_url
  // while the SmartRecruiters slug is pinned via
  // api: https://careers.smartrecruiters.com/<slug> in portals.yml.
  for (const raw of [entry.api, entry.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    if (!SR_CAREERS_HOSTS.has(parsed.hostname)) continue;
    const slug = parsed.pathname.split('/').filter(Boolean)[0];
    if (slug) return slug;
  }
  return null;
}

function buildPostingsUrl(slug, offset = 0) {
  return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${SR_PAGE_SIZE}&offset=${offset}&status=PUBLIC`;
}

function buildPostingDetailUrl(slug, id) {
  return `https://api.smartrecruiters.com/v1/companies/${slug}/postings/${encodeURIComponent(id)}`;
}

function resolveApiUrl(entry) {
  const slug = resolveSlug(entry);
  return slug ? buildPostingsUrl(slug, 0) : null;
}

/** @type {Provider} */
export default {
  id: 'smartrecruiters',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`smartrecruiters: cannot derive API URL for ${entry.name}`);

    // Honor the ctx.maxPages pagination hint (the portal health probe passes 1)
    // as a ceiling, and don't call that deliberate stop a truncation.
    const entryMaxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageLimit = Math.min(entryMaxPages, ctxCap);

    const all = [];
    let total = null; // the API's totalFound, when it reports one
    let ended = false; // a short or empty page ended the walk before the cap
    for (let page = 0; page < pageLimit; page++) {
      const apiUrl = buildPostingsUrl(slug, page * SR_PAGE_SIZE);
      assertSmartRecruitersUrl(apiUrl);
      const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
      if (total === null && Number.isSafeInteger(json?.totalFound) && json.totalFound >= 0) total = json.totalFound;
      const parsed = parseSmartRecruitersResponse(json, entry.name, slug);
      all.push(...parsed);
      // A dropped malformed ID must not hide postings on subsequent pages.
      if (!Array.isArray(json?.content) || json.content.length < SR_PAGE_SIZE) { ended = true; break; }
    }
    // The cap ended the walk with postings still unread, or with no sign the
    // board ended when the API reports no total. Said out loud: a silently
    // short board reads as a complete one.
    const truncated = !ended && entryMaxPages < ctxCap
      && (total === null || pageLimit * SR_PAGE_SIZE < total);
    if (truncated) {
      const counts = total === null ? `${all.length} jobs fetched, total unknown` : `${all.length} of ${total} jobs`;
      const advice = pageLimit < SR_HARD_MAX_PAGES
        ? `raise max_pages on this entry for more (up to ${SR_HARD_MAX_PAGES})`
        : `max_pages is already at the ${SR_HARD_MAX_PAGES}-page ceiling`;
      console.error(`⚠️  smartrecruiters: ${entry.name} truncated at max_pages=${pageLimit} (${counts}) — ${advice}`);
    }

    // Detail enrichment answers "what does this job say", not "is this
    // endpoint alive" — skip it entirely while probing so it never spends
    // budget a liveness check has no use for (same rule as vdab).
    const { fetchDetails, detailLimit } = parseSmartRecruitersConfig(entry);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    if (fetchDetails && !probing) {
      const jobs = all.filter((job) => job.id).slice(0, detailLimit);
      for (let i = 0; i < jobs.length; i += SR_DETAIL_BATCH) {
        const batch = jobs.slice(i, i + SR_DETAIL_BATCH);
        await Promise.all(batch.map(async (job) => {
          try {
            const detailUrl = buildPostingDetailUrl(slug, job.id);
            assertSmartRecruitersUrl(detailUrl);
            const detail = await ctx.fetchJson(detailUrl, { redirect: 'error' });
            const description = extractDescription(detail);
            if (description) job.description = description;
          } catch {
            // Detail fetch is an enrichment only. Keep the listing result.
          }
        }));
      }
    }

    // The numeric posting id drove the detail calls above; it is internal
    // plumbing and must not leak into the pipeline's Job rows (vdab strips
    // its id the same way).
    const jobs = all.map(({ id, ...job }) => job);
    if (truncated) {
      // Canonical shape read by lib/board-truncation.mjs, so scan.mjs logs the
      // board as `partial` instead of `reachable`.
      /** @type {any} */ (jobs).truncated = { reason: 'page-cap', fetched: jobs.length, ...(total === null ? {} : { total }) };
    }
    return jobs;
  },
};

/**
 * Parse a SmartRecruiters /postings response. Exported for unit tests.
 *
 * SmartRecruiters returns:
 *   { content: [{ id, name, ref, refNumber, language: { code },
 *                 location: { fullLocation?, city?, region?, country?, remote? } }] }
 *
 * - requisitionId: `refNumber`, the employer's requisition id. It is stable
 *   across re-releases of one requisition (each re-release gets a new posting
 *   `id`), and shared by every language version of it.
 * - language: `language.code`, the language code of the posting's text (`de`,
 *   `en-GB`, `pt-BR`).
 *
 * Both keys are omitted when the payload carries no usable value.
 *
 * - location: prefer `fullLocation`; else assemble from city/region/country
 *   parts (skipping empties); append "Remote" when `location.remote` is true.
 * - url: `j.ref` is an `api.smartrecruiters.com/v1/companies/<slug>/postings/<id>`
 *   URL — rewrite to the public `jobs.smartrecruiters.com/<slug>/<id>-<title-slug>`.
 *   The public site has no `/postings/` segment; carrying it over yields a 404,
 *   which the liveness checker then reports as an expired posting (#1612).
 *   SmartRecruiters resolves the page by id alone, so the trailing title slug is
 *   cosmetic. If `ref` is missing or untrusted, synthesise the same shape from
 *   the configured company slug + posting id. The display name is only a
 *   fallback for callers that do not supply a company slug.
 *   A posting that needs the fallback and has an unencodable ID (a lone
 *   surrogate) is omitted, so the result can be shorter than `content`.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} [companySlug] Already-escaped URL.pathname segment from resolveSlug.
 * @returns {Array<{title: string, url: string, company: string, location: string, id?: string, requisitionId?: string, language?: string}>}
 */
export function parseSmartRecruitersResponse(json, companyName, companySlug) {
  const items = json?.content;
  if (!Array.isArray(items)) return [];
  return items.flatMap(j => {
    const loc = j.location || {};
    const fullLocation = loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const remote = loc.remote ? 'Remote' : '';
    const location = [fullLocation, remote].filter(Boolean).join(', ');
    const slugified = (j.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let url = '';
    if (typeof j.ref === 'string') {
      let parsedRef;
      try { parsedRef = new URL(j.ref); } catch { parsedRef = null; }
      if (parsedRef
          && parsedRef.protocol === 'https:'
          && parsedRef.hostname === 'api.smartrecruiters.com'
          && parsedRef.pathname.startsWith('/v1/companies/')) {
        // /v1/companies/<slug>/postings/<id> → <slug>, <id>
        const [refSlug, postings, refId] = parsedRef.pathname
          .slice('/v1/companies/'.length)
          .split('/')
          .filter(Boolean);
        if (refSlug && postings === 'postings' && refId) {
          url = `https://jobs.smartrecruiters.com/${refSlug}/${refId}${slugified ? `-${slugified}` : ''}`;
        }
      }
    }
    if (!url && j.id) {
      const fallbackSlug = companySlug || (companyName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (fallbackSlug) {
        const encodedId = safeEncodeURIComponent(j.id);
        if (encodedId === null) return [];
        url = `https://jobs.smartrecruiters.com/${fallbackSlug}/${encodedId}${slugified ? `-${slugified}` : ''}`;
      }
    }
    const requisitionId = coerceId(j.refNumber);
    const language = coerceId(j.language?.code);
    // releasedDate is the posting's publish time. Without it every row was
    // undated, and the posting-age and --since filters pass an undated row.
    const postedAt = toEpochMs(j.releasedDate);
    return [{
      title: j.name || '',
      url,
      location,
      company: companyName,
      id: typeof j.id === 'string' || typeof j.id === 'number' ? String(j.id) : undefined,
      ...(requisitionId ? { requisitionId } : {}),
      ...(language ? { language } : {}),
      ...(postedAt !== undefined ? { postedAt } : {}),
    }];
  });
}
