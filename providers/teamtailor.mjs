// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Teamtailor provider — per-tenant public RSS feed.
//
// Every Teamtailor career site exposes a zero-auth XML jobs feed at
// `https://<slug>.teamtailor.com/jobs.rss`. The feed is public and no-auth, so
// it is parsed in-process with the same tiny tag extractor as
// providers/nodesk.mjs / providers/personio.mjs rather than adding an XML
// dependency.
//
// Auto-detects `https://<slug>.teamtailor.com/...` careers URLs. Many tenants
// front the same feed on a branded domain (e.g. careers.acme.com also serves
// /jobs.rss), so an entry with an explicit `provider: teamtailor` may point its
// `careers_url` (or `api:`) at that branded host and it will be used directly.
//
// SSRF stance mirrors the other providers: auto-detection stays pinned to
// `*.teamtailor.com` so untrusted careers URLs can never steer the fetch at an
// arbitrary host; a branded host is honored only when the user opted in with an
// explicit `provider: teamtailor`. Either way the fetch is HTTPS-only with
// `redirect: 'error'`. Job `<link>`s (branded domains) are emitted as-is and
// never fetched.

const TEAMTAILOR_HOST_RE = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.teamtailor\.com$/i;

/**
 * Validate a feed URL before fetching. Always HTTPS-only. The hostname is
 * pinned to `*.teamtailor.com` for auto-detected entries; an explicit
 * `provider: teamtailor` entry may use its configured branded host.
 * @param {string} url
 * @param {{ explicit?: boolean }} [opts]
 */
function assertFeedUrl(url, { explicit = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`teamtailor: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`teamtailor: URL must use HTTPS: ${url}`);
  if (!explicit && !TEAMTAILOR_HOST_RE.test(parsed.hostname)) {
    throw new Error(`teamtailor: untrusted hostname "${parsed.hostname}" — must be <slug>.teamtailor.com (or set "provider: teamtailor" to use a branded careers domain)`);
  }
  return url;
}

// Derive the RSS feed URL from a tracked_companies entry by normalizing any
// path on the configured host to /jobs.rss. Auto-detection (explicit=false)
// only claims *.teamtailor.com hosts; an explicit `provider: teamtailor` entry
// (explicit=true) may use a branded careers host. Returns null otherwise.
/**
 * @param {import('./_types.js').PortalEntry} entry
 * @param {{ explicit?: boolean }} [opts]
 */
function resolveFeedUrl(entry, { explicit = false } = {}) {
  const raw = entry?.api || entry?.careers_url || '';
  if (typeof raw !== 'string' || !raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!explicit && !TEAMTAILOR_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}/jobs.rss`;
}

function fallbackCompany(entry) {
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Teamtailor';
}

/** @type {Provider} */
export default {
  id: 'teamtailor',

  detect(entry) {
    // Auto-detection never claims a branded host — only *.teamtailor.com.
    const url = resolveFeedUrl(entry, { explicit: false });
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const explicit = entry?.provider === 'teamtailor';
    const feedUrl = resolveFeedUrl(entry, { explicit });
    if (!feedUrl) throw new Error(`teamtailor: cannot derive jobs.rss URL for ${fallbackCompany(entry)}`);
    assertFeedUrl(feedUrl, { explicit });
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertFeedUrl above it keeps the request pinned to the trusted host
    // (*.teamtailor.com, or the branded host the user explicitly configured).
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseTeamtailorFeed(text, fallbackCompany(entry));
  },
};

function fromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// Decode the XML entities that appear in RSS text: numeric (&#38; / &#x27;)
// and the named five. Numeric forms are decoded first; &amp; is decoded LAST
// so a literal "&amp;lt;" yields "&lt;" rather than over-decoding to "<".
function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeXmlEntities(inner).trim();
}

// Extract the text of the first <tag>...</tag> in a block. Returns '' when
// absent. Tag names may contain a namespace colon (e.g. tt:city).
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Keep only absolute HTTPS links. Teamtailor job URLs frequently live on a
// branded custom domain, so — unlike the feed host — the link host is not
// pinned; we only require a well-formed https URL.
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

// Build a human location from the first <tt:location> (city, country). Falls
// back to "Remote" when the posting carries no place but is flagged remote.
function resolveLocation(item) {
  const city = tagText(item, 'tt:city');
  const country = tagText(item, 'tt:country');
  const place = [city, country].filter(Boolean).join(', ');
  if (place) return place;
  const remote = tagText(item, 'remoteStatus').toLowerCase();
  return remote === 'fully' || remote === 'temporary' ? 'Remote' : '';
}

/**
 * Parse a Teamtailor public RSS jobs feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`. Each item
 * exposes `<title>`, `<link>`, `<pubDate>`, an optional `<remoteStatus>`, and
 * a `tt:` locations block (`<tt:city>`, `<tt:country>`). The company is not in
 * the item, so the tracked_companies `name` is used.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - company label for every posting
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseTeamtailorFeed(xml, defaultCompany = 'Teamtailor') {
  if (typeof xml !== 'string') return [];
  const company = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'Teamtailor';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const title = tagText(item, 'title');
    if (!title) continue;

    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    const job = {
      title,
      company,
      location: resolveLocation(item),
      url,
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}
