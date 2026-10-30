// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Homerun provider — per-tenant public Atom feed (→ tracked_companies:).
//
// Single-company ATS adapter: every Homerun account publishes its open jobs
// as a zero-auth Atom feed at `https://feed.homerun.co/<slug>`, where <slug>
// is the account's careers subdomain (`<slug>.homerun.co`). The careers page
// itself links that feed. No login, key or cookie; one request returns the
// whole board, so there is no pagination.
//
// detect() claims `<slug>.homerun.co` careers URLs and the feed URL itself.
// Tenants on a branded careers domain (`jobs.acme.example`) are not claimed —
// the slug can't be read off that host — so point `api:` at the feed URL the
// careers page links. A branded host with an explicit `provider: homerun`
// and no feed URL fails with a named error rather than guessing.
//
// SSRF: every request goes to the fixed literal host `feed.homerun.co`; only
// the slug comes from config, and SLUG_RE restricts it to one DNS label, so
// it can't carry a `/`, `?`, `#` or `..` into the path. The feed answers an
// unknown slug with a 302 to `https://404.homerun.co/feeds/<slug>`; the
// request uses redirect:'manual' only to read that Location off the thrown
// 3xx (never followed — same guarantee as redirect:'error') and turn it into
// a "no such tenant" 404, the way bamboohr.mjs does.
//
// Feed shape (verified live against public tenants, 2026-10-23):
//   <feed xmlns="http://www.w3.org/2005/Atom"> ... <entry>
//     <author><name>Acme</name></author>
//     <title type="text">Backend Engineer</title>
//     <link rel="alternate" type="text/html" href="https://acme.homerun.co/backend-engineer"></link>
//     <id>job_…</id>
//     <description type="html"><![CDATA[<p>…</p>]]></description>
//     <location><name>Amsterdam</name></location>
//     <salary_indication>€60000.00 to €70000.00 per year</salary_indication>
//     <updated>2026-09-29 15:07:45</updated>
//   </entry>
// An account with no open jobs serves the same <feed> with no <entry>.
// Entry links point at the tenant's careers site, which may be a branded
// domain, so the link host is not pinned (it is never fetched).
//
// Location is passed through as the tenant wrote it. Some tenants write a
// free-form value (`Remote-<City>`, a timezone band) that a country-name
// location_filter won't match; mapping those is left to the filter config.
//
// robots.txt: `https://feed.homerun.co/robots.txt` answers a 302 to Homerun's
// 404 page (no robots file on the feed host); `www.homerun.co/robots.txt` has
// only `Disallow: /cdn-cgi/` and `/llms.txt` under `User-agent: *`. Checked
// 2026-10-23.

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { compensationCurrency, compensationPeriod, parseAnnualCompensation } from './_salary-text.mjs';

const FEED_HOST = 'feed.homerun.co';

// One DNS label: the careers subdomain is the slug.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TENANT_HOST_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.homerun\.co$/i;

// Homerun's own subdomains, never a tenant's careers site.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'feed', 'help', 'static', 'cdn', 'api', 'developers', 'blog', '404']);

// Where feed.homerun.co sends an unknown slug.
const NOT_FOUND_LOCATION_RE = /^https:\/\/404\.homerun\.co\//i;

/**
 * Feed URL for an entry, or null when its careers_url / api names no Homerun
 * tenant. Only the slug is taken from the input; the URL is rebuilt on the
 * fixed feed host.
 * @param {any} entry
 * @returns {string | null}
 */
export function resolveHomerunFeedUrl(entry) {
  const raw = entry?.api || entry?.careers_url;
  if (typeof raw !== 'string' || !raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  let slug = '';
  if (host === FEED_HOST) {
    slug = parsed.pathname.split('/')[1] || '';
  } else {
    const m = host.match(TENANT_HOST_RE);
    if (!m || RESERVED_SUBDOMAINS.has(m[1])) return null;
    slug = m[1];
  }
  if (!SLUG_RE.test(slug)) return null;
  return `https://${FEED_HOST}/${slug.toLowerCase()}`;
}

/** @type {Provider} */
export default {
  id: 'homerun',

  detect(entry) {
    const url = resolveHomerunFeedUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = resolveHomerunFeedUrl(entry);
    if (!feedUrl) {
      throw new Error(`homerun: cannot derive the feed URL for ${entry?.name} — use a <slug>.homerun.co careers_url, or set api: to the https://${FEED_HOST}/<slug> feed the careers page links`);
    }
    let xml;
    try {
      xml = await ctx.fetchText(feedUrl, { redirect: 'manual' });
    } catch (err) {
      if (typeof err?.status === 'number' && err.status >= 300 && err.status < 400) {
        const tenantMissing = NOT_FOUND_LOCATION_RE.test(String(err.location || ''));
        const named = new Error(`homerun: ${feedUrl} redirected (${err.status} -> ${err.location})${tenantMissing ? ' — no such tenant' : ''}`);
        if (tenantMissing) /** @type {any} */ (named).status = 404;
        throw named;
      }
      throw err;
    }
    return parseHomerunFeed(xml, entry?.name);
  },
};

// CDATA sections hold the HTML description, which may itself contain
// `<title>`, `<link>` or `<location>`-looking markup. Mask them before
// matching structural tags, and restore only inside the extracted value.
/** @param {string} block */
function maskCdata(block) {
  /** @type {string[]} */
  const parts = [];
  const masked = block.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => {
    parts.push(inner);
    return `\u0000${parts.length - 1}\u0000`;
  });
  return { masked, parts };
}

/**
 * Inner text of the first <tag> in a masked block: a CDATA value raw, any
 * other value entity-decoded.
 * @param {string} masked @param {string[]} parts @param {string} tag
 */
function tagText(masked, parts, tag) {
  const m = masked.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  const cdata = m[1].match(/^\s*\u0000(\d+)\u0000\s*$/);
  if (cdata) return (parts[Number(cdata[1])] ?? '').trim();
  return decodeEntities(m[1].replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)] ?? '')).trim();
}

// Sequential attribute tokenizer (jobbankca.mjs): a quoted value is never
// re-scanned for sibling attributes.
/** @param {string} tag */
function attrsOf(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*(["'])((?:(?!\2)[\s\S])*)\2/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = m[3];
  return attrs;
}

/** @param {string} masked */
function linkHref(masked) {
  const links = (masked.match(/<link(?=[\s/>])[^>]*>/gi) || []).map(attrsOf);
  const alternate = links.find((a) => (a.rel || '').toLowerCase() === 'alternate') || links[0];
  return alternate?.href ? decodeEntities(alternate.href).trim() : '';
}

/** @param {string} value */
function httpsUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

// An ISO date-time that states its zone (Z or an offset).
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Entry `<updated>` is `YYYY-MM-DD HH:MM:SS` with no offset. Read as UTC: the
 * feed-level `<updated>` (ISO, `+00:00`) equals the newest entry's value.
 * @param {string} value
 */
function toEpochMs(value) {
  if (!value) return undefined;
  const naive = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  // Anything else must carry Z or an offset: Date.parse reads an offset-less
  // ISO date-time as local time, and V8 accepts loose strings like "Foo 12".
  if (!naive && !ISO_WITH_ZONE_RE.test(value)) return undefined;
  const parsed = Date.parse(naive ? `${naive[1]}T${naive[2]}Z` : value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * `<salary_indication>` is free text — `€60000.00 to €70000.00 per year`,
 * `€75000.00 per year`, `N/A`. Only an annual figure is kept.
 * @param {string} text
 * @returns {{min: number, max: number, currency?: string} | undefined}
 */
export function parseHomerunSalary(text) {
  if (!text || compensationPeriod(text) !== 'annual') return undefined;
  const amount = parseAnnualCompensation(text.replace(/\s+to\s+/i, ' - '));
  if (!amount || !(amount.max > 0)) return undefined;
  const currency = compensationCurrency(text);
  return { min: amount.min, max: amount.max, ...(currency ? { currency } : {}) };
}

/**
 * Parse a Homerun Atom jobs feed. Exported for unit tests.
 *
 * Throws when the body is not an Atom `<feed>`, or when it carries `<entry>`
 * elements none of which parse (a format change, not an empty board) or not
 * all of which are closed. A feed with no `<entry>` is an empty board → [].
 * A single entry missing its title or an https link is dropped.
 *
 * @param {unknown} xml
 * @param {unknown} [companyName] - the portals.yml entry name; falls back to the entry's <author><name>
 * @returns {import('./_types.js').Job[]}
 */
export function parseHomerunFeed(xml, companyName) {
  if (typeof xml !== 'string') {
    throw new Error(`homerun: unexpected response — expected an Atom <feed>, got: ${typeof xml}`);
  }
  // Mask CDATA across the whole document so raw markup inside a description
  // (an `</entry>`, a `</feed>`) can't end an entry or the feed early.
  const { masked: doc, parts } = maskCdata(xml);
  if (!/<feed\b/i.test(doc)) {
    throw new Error(`homerun: unexpected response — expected an Atom <feed>, got: ${xml.length} chars, no <feed>`);
  }
  // A truncated body would otherwise pass as a short or empty board.
  if (!/<\/feed\s*>/i.test(doc)) {
    throw new Error(`homerun: truncated response — <feed> has no closing </feed> (${xml.length} chars)`);
  }
  const configured = typeof companyName === 'string' ? companyName.trim() : '';
  const blocks = doc.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  // An unclosed <entry> matches no block (or merges into the next one), which
  // would read as an empty or shorter board.
  const opened = (doc.match(/<entry\b/gi) || []).length;
  if (opened !== blocks.length) {
    throw new Error(`homerun: malformed feed — ${opened} <entry> tags but ${blocks.length} closed entries`);
  }
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];

  for (const masked of blocks) {
    const title = tagText(masked, parts, 'title');
    const url = httpsUrl(linkHref(masked));
    if (!title || !url) continue;

    const author = masked.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i);
    const location = masked.match(/<location\b[^>]*>([\s\S]*?)<\/location>/i);
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url,
      company: configured || (author ? tagText(author[1], parts, 'name') : ''),
      location: location ? tagText(location[1], parts, 'name') : '',
    };
    const postedAt = toEpochMs(tagText(masked, parts, 'updated'));
    if (postedAt !== undefined) job.postedAt = postedAt;
    const description = htmlToText(tagText(masked, parts, 'description'));
    if (description) job.description = description;
    const salary = parseHomerunSalary(tagText(masked, parts, 'salary_indication'));
    if (salary) job.salary = salary;
    jobs.push(job);
  }

  if (blocks.length > 0 && jobs.length === 0) {
    throw new Error(`homerun: feed has ${blocks.length} <entry> elements but none parsed (no title or https link) — feed format changed?`);
  }
  return jobs;
}
