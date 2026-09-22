// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Collage HR public job-site API.  A job-site address is an explicit tenant
// identifier, not a company-name slug we should guess.  Entries may provide
// the exact API URL or a public Collage careers URL from which the final path
// segment is read.

const API_ORIGIN = 'https://api.collage.co';
const COLLAGE_API_HOST = 'api.collage.co';
const COLLAGE_SITE_HOST_RE = /^secure\.collage\.co$/;

/** @param {string} url */
function assertCollageApiUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`collage: invalid URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new Error(`collage: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== COLLAGE_API_HOST) {
    throw new Error(`collage: untrusted hostname "${parsed.hostname}" — must be ${COLLAGE_API_HOST}`);
  }
  if (!/^\/v1\/positions\/[^/?#]+$/.test(parsed.pathname)) {
    throw new Error(`collage: API URL must be /v1/positions/<job-site-address>: ${url}`);
  }
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  const explicit = typeof entry.api === 'string' ? entry.api.trim() : '';
  if (explicit) return assertCollageApiUrl(explicit);

  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' || !COLLAGE_SITE_HOST_RE.test(parsed.hostname)) return null;
  if (!/^\/jobs\/[^/]+(?:\/)?$/.test(parsed.pathname)) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const site = parts.at(-1);
  if (!site || site.includes('.')) return null;
  let decoded;
  try { decoded = decodeURIComponent(site); } catch { decoded = site; }
  if (!decoded || decoded.includes('/')) return null;
  return assertCollageApiUrl(`${API_ORIGIN}/v1/positions/${encodeURIComponent(decoded)}`);
}

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

/** @param {unknown} value */
function absoluteHttpsUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/** @param {any} json @param {string} companyName */
export function parseCollageResponse(json, companyName) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.positions) ? json.positions : null;
  if (!rows) throw new Error('collage: unrecognized response envelope (expected a positions array)');
  return rows.filter(j => j && text(j.title)).map(j => {
    const url = absoluteHttpsUrl(j.hostedUrl) || absoluteHttpsUrl(j.url) || absoluteHttpsUrl(j.applyUrl);
    if (!url) return null;
    const location = Array.isArray(j.location) ? j.location.map(text).filter(Boolean).join('; ') : text(j.location);
    const metadata = [
      text(j.department) && `Department: ${text(j.department)}`,
      text(j.commitment) && `Commitment: ${text(j.commitment)}`,
      text(j.employmentType) && `Employment type: ${text(j.employmentType)}`,
    ].filter(Boolean).join('\n');
    const description = [text(j.descriptionPlain), metadata].filter(Boolean).join('\n\n');
    return {
      title: text(j.title), url, company: companyName,
      location, description,
      postedAt: toEpochMs(j.createdDate ?? j.createdAt ?? j.publishedAt),
    };
  }).filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'collage',
  detect(entry) {
    try { const url = resolveApiUrl(entry); return url ? { url } : null; } catch { return null; }
  },
  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`collage: cannot derive API URL for ${entry.name}`);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseCollageResponse(json, entry.name);
  },
};
