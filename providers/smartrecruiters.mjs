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

import { intInRange } from './_config-utils.mjs';
import { htmlToText } from './_html-to-text.mjs';

const ALLOWED_SMARTRECRUITERS_HOSTS = new Set(['api.smartrecruiters.com']);
const SR_CAREERS_HOSTS = new Set(['careers.smartrecruiters.com', 'jobs.smartrecruiters.com']);
const SR_PAGE_SIZE = 100;
const SR_MAX_PAGES = 50;  // safety cap (5000 postings @ 100/page)
const SR_DETAIL_BATCH = 5;

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

    // Honor the ctx.maxPages pagination hint (the portal health probe passes 1);
    // a real sweep keeps the SR_MAX_PAGES safety cap.
    const pageLimit = Math.min(
      SR_MAX_PAGES,
      Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity,
    );

    const all = [];
    for (let page = 0; page < pageLimit; page++) {
      const apiUrl = buildPostingsUrl(slug, page * SR_PAGE_SIZE);
      assertSmartRecruitersUrl(apiUrl);
      const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
      const parsed = parseSmartRecruitersResponse(json, entry.name);
      if (parsed.length === 0) break;
      all.push(...parsed);
      if (parsed.length < SR_PAGE_SIZE) break;  // last page (short)
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
    return all.map(({ id, ...job }) => job);
  },
};

/**
 * Parse a SmartRecruiters /postings response. Exported for unit tests.
 *
 * SmartRecruiters returns:
 *   { content: [{ id, name, ref, location: { fullLocation?, city?, region?, country?, remote? } }] }
 *
 * - location: prefer `fullLocation`; else assemble from city/region/country
 *   parts (skipping empties); append "Remote" when `location.remote` is true.
 * - url: `j.ref` is an `api.smartrecruiters.com/v1/companies/<slug>/postings/<id>`
 *   URL — rewrite to the public `jobs.smartrecruiters.com/<slug>/<id>-<title-slug>`.
 *   The public site has no `/postings/` segment; carrying it over yields a 404,
 *   which the liveness checker then reports as an expired posting (#1612).
 *   SmartRecruiters resolves the page by id alone, so the trailing title slug is
 *   cosmetic. If `ref` is missing or untrusted, synthesise the same shape from
 *   the company slug + posting id.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, id?: string}>}
 */
export function parseSmartRecruitersResponse(json, companyName) {
  const items = json?.content;
  if (!Array.isArray(items)) return [];
  return items.map(j => {
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
      const companySlug = (companyName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (companySlug) {
        url = `https://jobs.smartrecruiters.com/${companySlug}/${j.id}${slugified ? `-${slugified}` : ''}`;
      }
    }
    return { title: j.name || '', url, location, company: companyName, id: typeof j.id === 'string' || typeof j.id === 'number' ? String(j.id) : undefined };
  });
}
