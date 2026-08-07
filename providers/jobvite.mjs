// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';

// Jobvite provider — scrapes the public, server-rendered careers page HTML.
// Used by ~3,000 companies across a wide range of industries.
//
//   GET https://jobs.jobvite.com/{companyId}/jobs
//   … <table class="jv-job-list"> … <td class="jv-job-list-name">
//       <a href="/{companyId}/job/{jobId}">{Title}</a></td>
//     <td class="jv-job-list-location">{City, Country}</td> … </table> …
//
// Auto-detects from careers_url pattern:
//   https://jobs.jobvite.com/{companyId}
//   https://jobs.jobvite.com/{companyId}/jobs
// The companyId is the slug segment immediately after the host.
//
// SSRF stance: the careers URL is rebuilt from the extracted slug only, never
// from a user-supplied path; assertJobviteUrl() pins the hostname to
// jobs.jobvite.com before every fetch. Per-job URLs are resolved against that
// origin when relative, or accepted as-is when already absolute (e.g. a
// branded-domain apply link) — either form is restricted to http:/https: and
// is display-only, never fetched here.
//
// Wire in via a `tracked_companies:` entry with:
//   careers_url: https://jobs.jobvite.com/{companyId}
// or explicitly with:
//   provider: jobvite
//   careers_url: https://jobs.jobvite.com/{companyId}/jobs

const ALLOWED_HOST = 'jobs.jobvite.com';
const ORIGIN = `https://${ALLOWED_HOST}`;

/** @param {string} url */
function assertJobviteUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobvite: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:')
    throw new Error(`jobvite: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST)
    throw new Error(`jobvite: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

// Looped to a fixed point rather than a single pass: a single global replace
// only removes non-overlapping matches in one left-to-right sweep, which
// CodeQL flags as an incomplete sanitizer (js/incomplete-sanitization) since
// adversarial nesting can leave a `<`-fragment behind. Repeating until the
// string stops changing removes any tag that pass N reveals.
function stripTags(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, ' ');
  } while (s !== prev);
  return s;
}

/** @param {string} s */
function clean(s) {
  // Strip the "New" ribbon badge some tenants inline into the title text
  // (e.g. <span class="jv-tag-new">New</span>, or with a tenant class token
  // alongside it, e.g. <span class="ml2 jv-tag-new">New</span>) before
  // flattening tags. A lookahead checks for the class token rather than
  // anchoring on attribute order, since `class` isn't guaranteed to be the
  // span's first attribute (e.g. a `data-*` attr before it).
  const noBadge = s.replace(/<span\b(?=[^>]*\bclass="[^"]*\bjv-tag-new\b[^"]*")[^>]*>[\s\S]*?<\/span>/gi, '');
  return decodeEntities(stripTags(noBadge)).replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

/**
 * Extract the companyId slug from a careers_url or (legacy) api URL.
 *
 * Accepted forms:
 *   https://jobs.jobvite.com/{slug}
 *   https://jobs.jobvite.com/{slug}/jobs
 *   https://jobs.jobvite.com/api/company/{slug}/jobs  (legacy explicit api: field)
 *
 * Returns null for any non-Jobvite or malformed URL.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveCompanyId(entry) {
  const raw = typeof entry.api === 'string' && entry.api
    ? entry.api
    : typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);

  // legacy api: https://jobs.jobvite.com/api/company/{slug}/jobs → ['api','company',slug,'jobs']
  const apiIdx = segments.indexOf('company');
  if (apiIdx !== -1 && segments[apiIdx + 1]) {
    return segments[apiIdx + 1];
  }

  // careers_url: https://jobs.jobvite.com/{slug}[/jobs] → [slug] or [slug, 'jobs']
  if (segments.length >= 1 && segments[0] !== 'api') {
    return segments[0];
  }

  return null;
}

/** @param {string} companyId */
function buildCareersUrl(companyId) {
  return `${ORIGIN}/${encodeURIComponent(companyId)}/jobs`;
}

/** @type {Provider} */
export default {
  id: 'jobvite',

  detect(entry) {
    const companyId = resolveCompanyId(entry);
    return companyId ? { url: buildCareersUrl(companyId) } : null;
  },

  async fetch(entry, ctx) {
    const companyId = resolveCompanyId(entry);
    if (!companyId) throw new Error(`jobvite: cannot derive company ID for ${entry.name}`);
    const careersUrl = buildCareersUrl(companyId);
    assertJobviteUrl(careersUrl);
    // redirect:'error' keeps the fetch pinned to jobs.jobvite.com — a stale
    // or invalid slug redirects to search.jobvite.com, and that redirect
    // should surface as a fetch failure, not silently follow.
    const html = await ctx.fetchText(careersUrl, { redirect: 'error', headers: { accept: 'text/html' } });
    return parseJobviteHtml(html, entry.name);
  },
};

// Jobvite ships (at least) three server-rendered list layouts for the same
// "classic" career-site theme:
//   table:    <td class="jv-job-list-name"><a href="{path}">{Title}</a></td>
//             <td class="jv-job-list-location">{City, Country}</td>
//   anchor:   <a href="{path}" class="jv-job-item …">
//               <div class="jv-job-list-name[ extra-class]">{Title}</div>
//               <div class="jv-job-list-location[ extra-class]">{City, Country}</div>
//             </a>
//   category: <div class="jv-job">
//               <a class="jv-job-name" href="{path}">{Title} <span>{City,
//               Country}</span></a>
//             </div>
//             (job rows grouped under per-category <table class="jv-job-list">
//             headers; title and location share one anchor instead of two
//             separate cells/divs)
// All three are tried; results are merged and deduped by URL. None cover the
// client-rendered ("faceted search") theme some tenants use instead — that
// one loads its job list via JS after page load, nothing to scrape from the
// initial HTML (see KNOWN_LAYOUT_MARKER below, which makes that case throw
// instead of silently reading as "zero jobs").
//
// Confirmed against live tenants: table (jacksonfamilywines), category (arc).
// The anchor/div path rests on fixtures reconstructed from Jobvite's
// published theme CSS — flag it if you find a live tenant on that variant
// that this doesn't match.
// Matches a class token as a whitespace-delimited word within a class
// attribute found anywhere among a tag's attributes — not anchored to
// attribute order (class needn't be first) and not fooled by a hyphenated
// near-miss like "jv-job-list-name-mobile" the way `\bTOKEN\b` would be,
// since `-` is a non-word character and satisfies `\b` on both sides of it.
const classToken = (token) => `(?=[^>]*\\bclass="(?:[^"]*\\s)?${token}(?:\\s[^"]*)?")`;

// All three supported themes render some element carrying one of these exact
// class tokens — the "jv-job-list" wrapper (<table>/<div>) around the whole
// list, the per-row "jv-job-list-name"/"jv-job-list-location" cells, the
// anchor variant's "jv-job-item" row class, or the category variant's
// "jv-job"/"jv-job-name" row markup — regardless of whether any given row
// ends up producing a valid job (e.g. one row dropped for a bad href scheme
// still leaves its markers behind). Their total absence is what separates
// "known layout, genuinely no jobs right now (or every row got filtered)"
// from "client-rendered faceted-search theme this provider can't scrape at
// all": the latter never emits any of this markup in the initial HTML,
// since the list loads via JS after page load.
const KNOWN_LAYOUT_MARKER = new RegExp(
  `<[a-z]+\\b(?:${classToken('jv-job-list')}|${classToken('jv-job-list-name')}|${classToken('jv-job-list-location')}|${classToken('jv-job-item')}|${classToken('jv-job')}|${classToken('jv-job-name')})`,
  'i',
);

const LIST_PATTERNS = [
  // An intervening `<td>` (e.g. a department/type column) can sit between
  // the name and location cells — `(?:(?!<\/?tr\b)[\s\S])*?` skips over any
  // such cells without ever crossing a `<tr>`/`</tr>` boundary, so a row
  // missing its location cell can never pick up the next row's location.
  // The title and location captures are bounded the same way (not just the
  // skip): a lazy `[\s\S]*?` can otherwise backtrack straight through a row
  // boundary when the rest of the pattern fails to match within the current
  // row, silently re-pairing one row's title with a later row's location.
  new RegExp(
    `<td\\b${classToken('jv-job-list-name')}[^>]*>\\s*<a\\s+[^>]*?href="([^"]+)"[^>]*>((?:(?!<\\/?td\\b|<\\/?tr\\b)[\\s\\S])*?)<\\/a>\\s*<\\/td>` +
    `(?:(?!<\\/?tr\\b)[\\s\\S])*?<td\\b${classToken('jv-job-list-location')}[^>]*>((?:(?!<\\/?tr\\b)[\\s\\S])*?)<\\/td>`,
    'g',
  ),
  // A `jv-job-type` div (e.g. "Full-Time") and/or a plain wrapper div (e.g.
  // `<div class="flex-col">`) sometimes sit between the anchor/name/location
  // pieces — including AFTER the location div (the wrapper's own closing
  // tag, or a sibling div like a "posted N days ago" note). `(?:(?!<\/?a\b)
  // [\s\S])*?` skips over any of them without ever crossing into a
  // neighboring `<a>`/`</a>` — a plain `[\s\S]*?` here can latch onto an
  // unrelated earlier anchor (e.g. a nav/share link) and grab its href for a
  // job title several entries later, or (used after the location capture)
  // swallow a trailing sibling's text into the location. The location
  // capture itself stays bound to `([\s\S]*?)<\/div>` — its own closing
  // tag — precisely because the skip after it, not the capture, is what
  // absorbs anything between that div and the real `</a>`.
  new RegExp(
    `<a\\s+[^>]*?href="([^"]+)"[^>]*>(?:(?!<\\/?a\\b)[\\s\\S])*?<div\\b${classToken('jv-job-list-name')}[^>]*>([\\s\\S]*?)<\\/div>` +
    `(?:(?!<\\/?a\\b)[\\s\\S])*?<div\\b${classToken('jv-job-list-location')}[^>]*>([\\s\\S]*?)<\\/div>(?:(?!<\\/?a\\b)[\\s\\S])*?<\\/a>`,
    'g',
  ),
  // Category variant (e.g. arc): title and location share a single anchor
  // instead of separate cells/divs — `<a class="jv-job-name" href="{path}">
  // {Title} <span>{City, Country}</span></a>` — rows are grouped under
  // per-category `<table class="jv-job-list">` headers, but that grouping is
  // irrelevant here since the pattern matches each `<a class="jv-job-name">`
  // directly regardless of its ancestor table. The title capture is bounded
  // by `<span` or `</a>` (not just `<span`) so a row with no location span
  // at all still yields a title instead of failing to match.
  new RegExp(
    `<a\\b${classToken('jv-job-name')}[^>]*?href="([^"]+)"[^>]*>((?:(?!<span\\b|<\\/a\\b)[\\s\\S])*?)<span\\b[^>]*>([\\s\\S]*?)<\\/span>(?:(?!<\\/a\\b)[\\s\\S])*?<\\/a>`,
    'g',
  ),
];

/**
 * Parse a Jobvite careers page (server-rendered HTML) into jobs. Exported for
 * unit tests. No posting date is exposed on the list page, so `postedAt` is
 * omitted — date filters (`--since`, `max_age_days`) never exclude Jobvite
 * rows, and they sort last among dated results.
 *
 * Throws rather than returning `[]` when zero jobs matched AND the page
 * carries none of the known-layout markers (see KNOWN_LAYOUT_MARKER) — that
 * combination means the tenant is on an unsupported theme (most likely the
 * client-rendered "faceted search" layout), not that the board is genuinely
 * empty. A recognized layout with zero matching rows still returns `[]`,
 * since that's a real answer.
 *
 * @param {unknown} html - raw HTML text of the careers page
 * @param {string} companyName - value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJobviteHtml(html, companyName) {
  if (typeof html !== 'string') return [];

  const out = [];
  const seen = new Set();

  for (const pattern of LIST_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(html))) {
      const href = decodeEntities(m[1]);
      const title = clean(m[2]);
      if (!title) continue;

      let url;
      try {
        const resolved = new URL(href, ORIGIN);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
        url = resolved.href;
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({ title, url, company: companyName, location: clean(m[3]) });
    }
  }

  if (out.length === 0 && !KNOWN_LAYOUT_MARKER.test(html)) {
    throw new Error(
      `jobvite: ${companyName} — no known Jobvite layout markers found in the careers page; ` +
      'this tenant is likely on the client-rendered ("faceted search") theme, which this provider does not support',
    );
  }

  return out;
}
