// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SmartRecruiters provider — hits the public postings API.
// Auto-detects from careers_url pattern
// `https://(careers|jobs).smartrecruiters.com/<slug>`. A tracked_companies
// entry can also set `provider: smartrecruiters` explicitly to bypass
// detection (useful when the public careers URL is a branded custom domain).

const ALLOWED_SMARTRECRUITERS_HOSTS = new Set(['api.smartrecruiters.com']);
const SR_CAREERS_HOSTS = new Set(['careers.smartrecruiters.com', 'jobs.smartrecruiters.com']);
const SR_PAGE_SIZE = 100;
const SR_MAX_PAGES = 50;  // safety cap (5000 postings @ 100/page)

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

    const all = [];
    for (let page = 0; page < SR_MAX_PAGES; page++) {
      const apiUrl = buildPostingsUrl(slug, page * SR_PAGE_SIZE);
      assertSmartRecruitersUrl(apiUrl);
      const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
      const parsed = parseSmartRecruitersResponse(json, entry.name);
      if (parsed.length === 0) break;
      all.push(...parsed);
      if (parsed.length < SR_PAGE_SIZE) break;  // last page (short)
    }
    return all;
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
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
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
    return { title: j.name || '', url, location, company: companyName };
  });
}
