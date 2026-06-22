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
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!SR_CAREERS_HOSTS.has(parsed.hostname)) return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  return slug || null;
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
 *   URL — rewrite to the public `jobs.smartrecruiters.com/<slug>/postings/<id>`.
 *   If `ref` is missing, synthesise a URL from the company slug + posting id.
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
        const restOfPath = parsedRef.pathname.slice('/v1/companies/'.length);
        url = `https://jobs.smartrecruiters.com/${restOfPath}`;
      }
    }
    if (!url && j.id) {
      const companySlug = (companyName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (companySlug) {
        url = `https://jobs.smartrecruiters.com/${companySlug}/${j.id}-${slugified}`;
      }
    }
    return { title: j.name || '', url, location, company: companyName };
  });
}
