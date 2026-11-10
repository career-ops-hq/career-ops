// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry } from './_http.mjs';

// Frontline AppliTrack provider — K-12 school districts hosted at
// `https://www.applitrack.com/<slug>/onlineapp/`. tracked_companies: (one entry
// = one district).
//
// The public board is a shell page that loads `jobpostings/Output.asp`, a script
// which document.write()s the whole vacancy list as HTML. Fetching that script
// directly returns every posting in ONE plain request, so there is no
// pagination and no browser. Auto-detects from an applitrack.com careers_url.
//
// Optional entry field `default_location` (e.g. "Kalama, WA"): AppliTrack's
// per-posting Location is a site name ("District", "Woodland High School") that
// often names no place, and location_filter needs one to match. When the site
// name lacks the default's city, it is appended.
//
// Encoding: the script is served as Windows-1252 but ctx.fetchText decodes
// UTF-8, so a non-ASCII byte (an en dash in a title) arrives as U+FFFD. It is
// stripped rather than shown as a replacement character.

const APPLITRACK_HOSTS = new Set(['www.applitrack.com', 'applitrack.com']);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * District slug from an applitrack.com URL, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveSlug(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !APPLITRACK_HOSTS.has(parsed.hostname)) return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  return SLUG_RE.test(slug) ? slug.toLowerCase() : null;
}

/** @param {string} slug */
const baseFor = (slug) => `https://www.applitrack.com/${slug}/onlineapp`;

/** @type {Provider} */
export default {
  id: 'applitrack',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: `${baseFor(slug)}/jobpostings/Output.asp?all=1` } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`applitrack: cannot derive district slug for ${entry.name} (need an https://www.applitrack.com/<slug>/... careers_url)`);
    const base = baseFor(slug);
    // Host is a fixed literal and the slug is charset-checked; redirect:'error'
    // keeps the request from being bounced anywhere else.
    const body = await fetchTextWithRetry(ctx, `${base}/jobpostings/Output.asp?all=1`, { redirect: 'error' });
    const defaultLocation = typeof entry.default_location === 'string' ? entry.default_location : '';
    return parseApplitrackOutput(body, entry.name, base, defaultLocation);
  },
};

/** @param {string} s */
const text = (s) =>
  decodeEntities(String(s).replace(/<[^>]+>/g, ' '))
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * "9/21/2026" → epoch ms (UTC midnight), or undefined for anything that is not a
 * real calendar date.
 * @param {string} value
 */
function toEpochMs(value) {
  const m = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[3]), Number(m[1]), Number(m[2])];
  const ms = Date.UTC(year, month - 1, day);
  // Date.UTC rolls an impossible date over (13/45 → a real day in 2027) instead
  // of returning NaN, so require the calendar date to survive the round trip.
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return ms;
}

/**
 * Parse an AppliTrack `Output.asp` body. Exported for unit tests.
 *
 * The HTML sits inside JS string literals, so quotes arrive backslash-escaped.
 * Every posting starts with `<table class='title'>` holding its title and
 * `JobID: <n>`; its fields follow as `<span class="label">Name:</span> …
 * <span class="normal">Value</span>`.
 *
 * - Empty/blank body → [] (nothing to parse).
 * - A body with no `function applyFor` — the script prelude every real response
 *   carries — is not this endpoint, so it throws rather than reading as an
 *   empty board forever.
 * - A block with no JobID or no title is skipped.
 *
 * @param {string} body
 * @param {string} companyName
 * @param {string} base  e.g. "https://www.applitrack.com/acme/onlineapp"
 * @param {string} [defaultLocation]
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseApplitrackOutput(body, companyName, base, defaultLocation = '') {
  if (typeof body !== 'string' || !body.trim()) return [];
  if (!body.includes('function applyFor')) {
    throw new Error('applitrack: response is not an AppliTrack Output.asp script (no applyFor prelude)');
  }
  const html = body.replace(/\\'/g, "'").replace(/\\"/g, '"');
  const cityName = defaultLocation.split(',')[0].trim().toLowerCase();

  const jobs = [];
  const seen = new Set();
  for (const block of html.split(/<table class='title'/i).slice(1)) {
    const id = (block.match(/JobID:\s*(\d+)/i) || [])[1];
    const title = text((block.match(/<td id='wrapword'[^>]*>([\s\S]*?)<\/td>/i) || [])[1] || '');
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);

    /** @param {string} name */
    const field = (name) => {
      const re = new RegExp(`${name}:\\s*</span>[\\s\\S]*?<span class=['"]normal['"][^>]*>([\\s\\S]*?)</span>`, 'i');
      return text((block.match(re) || [])[1] || '');
    };
    const site = field('Location');
    const location =
      site && (!cityName || site.toLowerCase().includes(cityName))
        ? site
        : [site, defaultLocation].filter(Boolean).join(' - ');
    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = {
      title,
      // `id` is digits only (matched above), so nothing here needs encoding.
      url: `${base}/default.aspx?AppliTrackJobId=${id}&AppliTrackLayoutMode=detail&AppliTrackViewPosting=1`,
      company: companyName,
      location,
    };
    const postedAt = toEpochMs(field('Date Posted'));
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}
