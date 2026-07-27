// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Agentic Engineering Jobs provider — scrapes the server-rendered listing at
// https://agentic-engineering-jobs.com/. The site has no public API, but every
// job card is plain HTML wrapped in a `data-impression-slug` container, so the
// full list is parseable from one page fetch (zero tokens, no browser).
//
// Card text lines after tag-stripping follow a stable order:
//   [Featured?] → title → company → location → tech tags… → 🇺🇸 flag → [date]
// The country flag emoji is decoded to a country name and appended to the
// location so scan.mjs's location_filter can gate non-US postings that only
// say "Remote".
//
// Wire in via a `job_boards:` entry with `provider: agentic-jobs`.

const SITE_ORIGIN = 'https://agentic-engineering-jobs.com';
const TRUSTED_HOST = 'agentic-engineering-jobs.com';

/** @param {string} url */
function assertAgenticUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`agentic-jobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`agentic-jobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`agentic-jobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Convert a two-letter regional-indicator flag emoji (e.g. 🇩🇪) into an
 * English country name ("Germany"). Returns '' when the input isn't a flag or
 * the region code can't be resolved.
 * @param {string} s
 */
export function flagToCountry(s) {
  const cps = [...s];
  if (cps.length !== 2) return '';
  const codes = cps.map((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return cp >= 0x1f1e6 && cp <= 0x1f1ff ? String.fromCharCode(cp - 0x1f1e6 + 65) : '';
  });
  if (codes.some((c) => !c)) return '';
  try {
    const name = regionNames.of(codes.join(''));
    return name && name !== codes.join('') ? name : '';
  } catch {
    return '';
  }
}

/**
 * Parse one job card's HTML segment into text lines (tags stripped, entities
 * decoded, blanks removed). Exported for tests.
 * @param {string} segment
 */
export function cardLines(segment) {
  const noMedia = segment.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<img[^>]*>/gi, ' ');
  return noMedia
    .split(/<[^>]+>/)
    .map((t) => decodeEntities(t).trim())
    .filter(Boolean);
}

/**
 * Normalize one card. Exported for tests.
 * @param {string} slug
 * @param {string[]} lines
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeAgenticCard(slug, lines) {
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) return null;
  // Drop the leftover `slug">` artifact of the split plus any Featured badge.
  const fields = lines.filter((l) => !l.includes('">') && l !== 'Featured');
  if (fields.length < 2) return null;
  const [title, company, maybeLocation] = fields;
  if (!title || !company) return null;

  // A card without a location line slides the flag-emoji line into this slot —
  // a bare flag is never a location (it resolves to the country name below).
  let location =
    maybeLocation && !/^\d{4}-\d{2}-\d{2}$/.test(maybeLocation) && !flagToCountry(maybeLocation) ? maybeLocation : '';
  const flag = fields.map(flagToCountry).find(Boolean);
  if (flag) location = location ? `${location}, ${flag}` : flag;

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url: `${SITE_ORIGIN}/jobs/${slug}`, company, location };

  const dateLine = fields.find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  if (dateLine) {
    const parsed = Date.parse(`${dateLine}T00:00:00Z`);
    if (!Number.isNaN(parsed)) job.postedAt = parsed;
  }
  return job;
}

/**
 * Parse the full listing page. Exported for tests.
 * @param {string} html
 */
export function parseAgenticListing(html) {
  const out = [];
  const seen = new Set();
  const segments = html.split(/<div[^>]*\bdata-impression-slug="/).slice(1);
  for (const seg of segments) {
    const slug = seg.slice(0, seg.indexOf('"'));
    // Cards can nest other markup; stop this card at the next card boundary.
    const nextCard = seg.indexOf('data-impression-slug', slug.length + 2);
    const body = nextCard > 0 ? seg.slice(0, nextCard) : seg;
    const job = normalizeAgenticCard(slug, cardLines(body));
    if (job && !seen.has(job.url)) {
      seen.add(job.url);
      out.push(job);
    }
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'agentic-jobs',

  detect(entry) {
    return entry?.provider === 'agentic-jobs' ? { url: SITE_ORIGIN } : null;
  },

  async fetch(_entry, ctx) {
    const url = assertAgenticUrl(`${SITE_ORIGIN}/`);
    // redirect:'error' prevents SSRF via server-side redirects
    const html = await ctx.fetchText(url, { redirect: 'error' });
    const jobs = parseAgenticListing(html);
    if (jobs.length === 0) {
      throw new Error(
        'agentic-jobs: parsed 0 job cards — the site markup likely changed (expected data-impression-slug containers)',
      );
    }
    return jobs;
  },
};
