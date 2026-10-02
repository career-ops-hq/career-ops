import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Startup Jobs provider — the board-wide public RSS feed at
// https://startup.jobs/feeds/jobs (global startup/scale-up job aggregator).
// The feed is public, no-auth, and XML; startup.jobs's JSON API
// (api.startup.jobs) requires a bearer-token account and is NOT used here —
// providers read public, no-auth sources only. The feed returns a fixed
// snapshot of the most recent ~50 matching postings (no cursor/pagination),
// so this is a single-fetch provider, the same shape as providers/larajobs.mjs.
//
// Query params (both optional, passed through entry.startup_jobs): `role`
// (a role slug, e.g. "platform-engineer", "site-reliability-engineer",
// "devops-engineer", "engineering" — confirmed live, not an exhaustive
// documented list since /v1/roles sits behind the gated JSON API) and
// `workplace` (free-text, e.g. "remote" — confirmed live, changes the result
// set). The JSON API additionally documents a `country` param, but it is a
// confirmed no-op on this RSS endpoint (identical output with and without
// it, including for a nonsense code) and is deliberately NOT exposed here —
// NL eligibility is left entirely to the global location_filter instead.
//
// The feed exposes no structured company/location fields (unlike LaraJobs'
// job: namespace), so both are parsed heuristically:
//   - company: the title's trailing "... at {Company}" segment, split on the
//     LAST " at " (a company literally named "...at..." would mis-split —
//     accepted, defensive fallback below keeps the item instead of dropping it).
//   - location: the description's last non-empty line, with anything after
//     " · " (a trailing comp range) stripped. Observed shapes: "{body}\n\n{Location}",
//     "{body}\n\n{Location} · {Comp}", or just "{Location}" with no body at all.
//
// Wire in via a `job_boards:` entry with `provider: startup-jobs`.

const FEED_HOST = 'startup.jobs';
const FEED_PATH = '/feeds/jobs';

/** @param {string} url */
function assertStartupJobsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`startup-jobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`startup-jobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== FEED_HOST) {
    throw new Error(`startup-jobs: untrusted hostname "${parsed.hostname}" - must be ${FEED_HOST}`);
  }
  return url;
}

function buildFeedUrl(entry) {
  const cfg = entry?.startup_jobs && typeof entry.startup_jobs === 'object' ? entry.startup_jobs : {};
  const params = new URLSearchParams();
  if (typeof cfg.role === 'string' && cfg.role.trim()) params.set('role', cfg.role.trim());
  if (typeof cfg.workplace === 'string' && cfg.workplace.trim()) params.set('workplace', cfg.workplace.trim());
  const qs = params.toString();
  return `https://${FEED_HOST}${FEED_PATH}${qs ? `?${qs}` : ''}`;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const DEFAULT_COMPANY = 'Startup Jobs';

/** Split "{Role} at {Company}" on the LAST " at " — returns [title, company]. */
function splitTitleCompany(rawTitle, fallbackCompany) {
  const fallback = typeof fallbackCompany === 'string' && fallbackCompany.trim() ? fallbackCompany.trim() : DEFAULT_COMPANY;
  const idx = rawTitle.lastIndexOf(' at ');
  if (idx === -1) return { title: rawTitle, company: fallback };
  const title = rawTitle.slice(0, idx).trim();
  const company = rawTitle.slice(idx + 4).trim();
  if (!title || !company) return { title: rawTitle, company: fallback };
  return { title, company };
}

/** Last non-empty line of the description, with a trailing " · {comp}" stripped. */
function extractLocation(description) {
  if (!description) return '';
  const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const last = lines[lines.length - 1];
  const sep = last.indexOf(' · ');
  return (sep === -1 ? last : last.slice(0, sep)).trim();
}

/** @type {Provider} */
export default {
  id: 'startup-jobs',

  detect(entry) {
    return entry?.provider === 'startup-jobs' ? { url: buildFeedUrl(entry) } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = assertStartupJobsUrl(buildFeedUrl(entry));
    // redirect:'error' prevents SSRF via server-side redirects; the hostname
    // is always the fixed FEED_HOST regardless of entry-supplied query params.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseStartupJobsFeed(text, entry?.name);
  },
};

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(inner).trim();
}

// Extract the text of the first <tag>...</tag> in a block. Returns '' when absent.
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

// Keep only absolute HTTPS links hosted on startup.jobs; strips the feed's
// utm_* tracking query string down to the canonical posting path.
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.hostname !== FEED_HOST) return '';
    return `https://${parsed.hostname}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Parse Startup Jobs' public RSS feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`. Each item
 * exposes `<title>` ("{Role} at {Company}"), `<link>`, `<pubDate>`, and a
 * `<description>` whose last line is the location (optionally followed by
 * " · {comp range}"). No structured company/location fields are offered.
 *
 * The `<description>` text is also carried as plain-text `description` (it
 * ships in the same payload, so it is free), giving the scanner's
 * content_filter and visa_filter something to read.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - fallback company when a title has no " at " segment
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseStartupJobsFeed(xml, defaultCompany = DEFAULT_COMPANY) {
  if (typeof xml !== 'string') return [];
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    const { title, company } = splitTitleCompany(rawTitle, defaultCompany);
    const description = tagText(item, 'description');
    const postedAt = toEpochMs(tagText(item, 'pubDate'));

    const job = {
      title,
      company,
      location: extractLocation(description),
      url,
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    // Location above reads the raw lines; the description is flattened to
    // plain text (and capped) by the shared helper, like pythonorg.mjs does.
    const descriptionText = htmlToText(description);
    if (descriptionText) job.description = descriptionText;
    jobs.push(job);
  }

  return jobs;
}
