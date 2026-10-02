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
//     accepted). A title with no usable " at " segment has no identifiable
//     employer, so the row is skipped entirely rather than attributed to the
//     board itself — a listing the scanner can't name a real employer for is
//     not a real, employer-attributed posting (providers/ADDING_A_PROVIDER.md).
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

/**
 * Split "{Role} at {Company}" on the LAST " at " segment. Returns `null`
 * when the title carries no usable employer segment — the caller skips that
 * row rather than attributing it to the board itself.
 */
function splitTitleCompany(rawTitle) {
  const idx = rawTitle.lastIndexOf(' at ');
  if (idx === -1) return null;
  const title = rawTitle.slice(0, idx).trim();
  const company = rawTitle.slice(idx + 4).trim();
  if (!title || !company) return null;
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
    return parseStartupJobsFeed(text);
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

// The documented envelope is `<rss>...<channel>...</channel>...</rss>` (item
// blocks live inside it, but a feed can legitimately have zero of them — a
// genuinely empty board). Anything short of that — an empty body, a truncated
// fetch, an HTML error page, a non-string argument — is not the documented
// shape and is not silently read as "zero jobs" (providers/ADDING_A_PROVIDER.md
// "Defensive parsing": a malformed envelope is a descriptive throw, never a
// quiet `[]`, so an upstream break surfaces instead of reading as 0 forever).
const ENVELOPE_RE = /<rss\b[^>]*>[\s\S]*<channel\b[^>]*>[\s\S]*<\/channel>[\s\S]*<\/rss>/i;

// CDATA sections carry a job <description>'s raw, unescaped text, which can
// itself contain the literal substrings "<item>" / "</item>" / "</channel>" /
// "</rss>" (e.g. a posting that mentions XML/RSS tooling). Matching envelope
// shape, tag counts, or item boundaries directly against the raw XML would
// mistake that text for real structure — at best false-positiving the
// malformed-feed checks below, at worst (a non-greedy item-boundary match)
// silently truncating that item's own description/location at the embedded
// "</item>", while its earlier fields (title, company) still parse fine and
// mask the loss. Replace each CDATA section with same-length filler first:
// positions stay aligned with the original string, so a matched item block's
// start/length can be used to slice the REAL xml (preserving the actual CDATA
// content), while the filler itself never matches a tag.
function maskCdata(str) {
  return str.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => '#'.repeat(m.length));
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
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseStartupJobsFeed(xml) {
  if (typeof xml !== 'string') {
    throw new Error(`startup-jobs: unexpected feed response — expected an <rss><channel> envelope, got: ${typeof xml}`);
  }

  const maskedXml = maskCdata(xml);

  if (!ENVELOPE_RE.test(maskedXml)) {
    throw new Error(`startup-jobs: unexpected feed response — expected an <rss><channel> envelope, got: ${xml.length}-char body`);
  }

  // A valid outer envelope can still wrap a body truncated mid-item — e.g. a
  // response cut off after an opening <item> but before its closing tag,
  // with a stray </channel></rss> tail from buffering/retry behavior. The
  // non-greedy item regex below would simply not match that dangling <item>,
  // so an otherwise-truncated feed would read as "zero items" — a genuinely
  // empty board — instead of the broken fetch it actually is. Count open vs
  // close tags within the (masked) channel body first: a mismatch is
  // unambiguous truncation evidence and throws, rather than silently
  // dropping the incomplete item and returning whatever did parse.
  const maskedChannelBody = (maskedXml.match(/<channel\b[^>]*>([\s\S]*)<\/channel>/i) || [, ''])[1];
  const openItems = (maskedChannelBody.match(/<item\b/gi) || []).length;
  const closedItems = (maskedChannelBody.match(/<\/item>/gi) || []).length;
  if (openItems !== closedItems) {
    throw new Error(`startup-jobs: malformed feed — ${openItems} <item> open tag(s) but ${closedItems} </item> close tag(s) (truncated response?)`);
  }

  // Item boundaries are matched against the masked xml (so CDATA text can't
  // end a block early), but each block is then sliced from the REAL xml at
  // that same position/length, preserving the actual CDATA content for the
  // field parsing below.
  const jobs = [];
  const blocks = [];
  for (const m of maskedXml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)) {
    blocks.push(xml.slice(m.index, m.index + m[0].length));
  }

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    const split = splitTitleCompany(rawTitle);
    if (!split) continue; // no " at " segment — employer unknown, skip the row
    const { title, company } = split;
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
