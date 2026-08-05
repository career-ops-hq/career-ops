// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Workable provider — public, no-auth account widget API:
//   GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true
//   → { name, description, jobs: [{ title, shortcode, shortlink, url, department,
//        city, state, country, telecommuting, published_on, description, … }] }
//
// The widget API returns the account's FULL posting list in one request (verified
// live against a 259-posting account) and ships `description` + `published_on`
// for free, so scan.mjs's content_filter and the recency logic in
// scan-ats-full.mjs both work for Workable companies.
//
// The older markdown feed at /<slug>/jobs.md is kept as a fallback only. It
// cannot be the primary path:
//   · on a large account the bare feed returns a department *summary* instead of
//     the job table, so there are no rows to parse — a 259-posting account
//     silently yielded ZERO jobs;
//   · it is hard-capped at 30 rows and honours no pagination parameter
//     (page/offset/limit/startrow all return the same first 30);
//   · segmenting by `?department=` is incomplete (departments listed in the
//     summary sum to less than the account total, and a department over 30 roles
//     is itself truncated).
//
// Auto-detects from careers_url pattern `https://apply.workable.com/<slug>`. A
// tracked_companies entry can also set `provider: workable` to bypass detection.

import { decodeEntities } from './_html-entities.mjs';

const ALLOWED_WORKABLE_HOSTS = new Set(['apply.workable.com']);

// Workable account slugs are alphanumerics plus - and _ . Anything else is
// rejected rather than interpolated, so a crafted careers_url cannot escape the
// path (e.g. `..%2f..%2f`) when we build the API URL.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertWorkableUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`workable: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`workable: URL must use HTTPS: ${url}`);
  if (!ALLOWED_WORKABLE_HOSTS.has(parsed.hostname)) {
    throw new Error(`workable: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_WORKABLE_HOSTS].join(', ')}`);
  }
  return url;
}

/**
 * Extract the account slug from a tracked_companies entry's careers_url.
 * @returns {string|null}
 */
export function resolveWorkableSlug(entry) {
  const raw = entry && typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'apply.workable.com') return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  if (!slug || !SLUG_RE.test(slug)) return null;
  return slug;
}

const widgetUrlFor = (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
const feedUrlFor = (slug) => `https://apply.workable.com/${slug}/jobs.md`;

/** @type {Provider} */
export default {
  id: 'workable',

  detect(entry) {
    const slug = resolveWorkableSlug(entry);
    return slug ? { url: widgetUrlFor(slug) } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveWorkableSlug(entry);
    if (!slug) throw new Error(`workable: cannot derive feed URL for ${entry.name}`);

    // Primary: widget API. assertWorkableUrl + redirect:'error' together
    // guarantee the final hostname stays in the allowlist (no SSRF via redirect).
    const apiUrl = assertWorkableUrl(widgetUrlFor(slug));
    let payload = null;
    try {
      payload = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    } catch {
      payload = null; // fall through to the markdown feed
    }
    if (payload && Array.isArray(payload.jobs)) {
      return parseWorkableWidget(payload, entry.name);
    }

    // Fallback: legacy markdown feed (small accounts only — see header note).
    const feedUrl = assertWorkableUrl(feedUrlFor(slug));
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseWorkableMarkdown(text, entry.name);
  },
};

/**
 * Validate a job URL against the Workable allowlist.
 * @returns {string|null} normalized href, or null when it must be dropped
 */
function safeJobUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_WORKABLE_HOSTS.has(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Build the location string. The markdown feed rendered "<city>, <country>"; we
 * match that shape so location_filter behaves identically across both paths.
 */
function formatLocation(job) {
  const parts = [job?.city, job?.country].filter(v => typeof v === 'string' && v.trim());
  const joined = parts.map(v => v.trim()).join(', ');
  if (joined) return joined;
  return job?.telecommuting ? 'Remote' : '';
}

/** Strip HTML tags/entities from the widget's rich-text description. */
function toPlainText(html) {
  if (typeof html !== 'string' || !html) return '';
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse the widget API payload. Exported for unit tests.
 *
 * @param {any} payload — parsed JSON body of the widget endpoint
 * @param {string} companyName — value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseWorkableWidget(payload, companyName) {
  if (!payload || !Array.isArray(payload.jobs)) return [];
  const jobs = [];
  const seen = new Set();
  for (const raw of payload.jobs) {
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!title) continue;

    // shortlink is the canonical public permalink; url is the same host. Either
    // is fine, both are validated. Off-domain or non-https entries are dropped.
    const url = safeJobUrl(raw?.shortlink) || safeJobUrl(raw?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    /** @type {any} */
    const job = { title, url, location: formatLocation(raw), company: companyName };

    const description = toPlainText(raw?.description);
    if (description) job.description = description;

    const stamp = Date.parse(raw?.published_on || raw?.created_at || '');
    if (Number.isFinite(stamp)) job.postedAt = stamp;

    jobs.push(job);
  }
  return jobs;
}

/**
 * Parse Workable's public markdown feed. Fallback path — see the header note on
 * why this can't be primary. Exported as a named export for unit tests. The feed
 * exposes a table:
 *   | Title | Department | Location | Type | Salary | Posted | Details |
 * where `Details` holds a markdown link
 *   [View](https://apply.workable.com/<slug>/jobs/view/<id>.md)
 * URLs are validated against `https://apply.workable.com/` — off-domain or
 * non-HTTPS [View] links are skipped (not emitted).
 *
 * @param {string} text — markdown body
 * @param {string} companyName — value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseWorkableMarkdown(text, companyName) {
  if (typeof text !== 'string') return [];
  const jobs = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes('[View]')) continue;
    const cols = line.split('|').map(c => c.trim());
    // Cols: ['', title, dept, location, type, salary, posted, '[View](url.md)', '']
    if (cols.length < 8) continue;
    const title = cols[1];
    if (!title || title === 'Title') continue;
    const location = cols[3] || '';
    const urlMatch = line.match(/\[View\]\(([^)]+)\)/);
    let url = urlMatch ? urlMatch[1] : '';
    if (url.endsWith('.md')) url = url.slice(0, -3);
    if (!url) continue;  // skip rows with no resolvable URL (e.g., malformed [View] link)

    const safe = safeJobUrl(url);
    if (!safe) continue;

    jobs.push({ title, url: safe, location, company: companyName });
  }
  return jobs;
}
