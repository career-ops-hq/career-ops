// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobvite provider — per-tenant public jobs feed.
// Used by ~3,000 companies across a wide range of industries.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS USES THE XML FEED AND NOT THE JSON API
//
// This provider previously fetched:
//
//   GET https://jobs.jobvite.com/api/company/{slug}/jobs
//
// That endpoint is retired. It now answers 302 to
// `http://search.jobvite.com?invalid=1` for every tenant, so the provider
// returned zero jobs for everyone rather than failing loudly. Verified
// 2026-08-08 against six tenants — zoom, starbucks, servicenow, twilio,
// blueorigin and tylertech — all identical.
//
// The working public feed is XML, on a DIFFERENT host:
//
//   GET https://app.jobvite.com/CompanyJobs/Xml.aspx?c={companyEId}
//   <result><job>
//     <id>…</id><title>…</title><category>…</category>
//     <location>…</location><date>M/D/YYYY</date>
//     <detail-url><![CDATA[…]]></detail-url>
//     <apply-url><![CDATA[…]]></apply-url>
//   </job>…</result>
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TENANT IDENTIFIER CHANGED SHAPE
//
// The old API keyed on the vanity slug from the careers URL ("tylertech").
// The XML feed keys on an opaque `companyEId` ("q6NaVfwI") which does NOT
// appear in the careers URL — it is only in the board page's inline JS as
// `companyEId: 'q6NaVfwI'`.
//
// So a slug alone is no longer sufficient. Resolution order:
//   1. `company_eid:` on the portal entry            (explicit, no network)
//   2. `c=` query param of an explicit `api:` URL    (explicit, no network)
//   3. discovery: GET the board page and scrape it   (one extra request, cached)
//
// Prefer (1) in config — it is one line, survives board redesigns, and skips
// a request per scan. Discovery exists so an entry that only knows the vanity
// URL still works.
//
// ─────────────────────────────────────────────────────────────────────────────
// SSRF stance: both hosts are pinned by assertJobviteHost() before every
// fetch, and every request uses redirect:'error' so a server-side redirect
// cannot move the final hostname. The eId is used only as a query-param value,
// never as a path segment. Per-job apply/detail URLs are display-only (written
// to pipeline/history, never fetched here) and are accepted from any https:
// origin, since Jobvite tenants commonly brand them onto their own domain.
//
// Wire in via a `tracked_companies:` entry, cheapest form first:
//   careers_url: https://jobs.jobvite.com/{slug}
//   company_eid: {companyEId}
// or explicitly:
//   provider: jobvite
//   api: https://app.jobvite.com/CompanyJobs/Xml.aspx?c={companyEId}

const BOARD_HOST = 'jobs.jobvite.com';
const FEED_HOST = 'app.jobvite.com';
const ALLOWED_HOSTS = new Set([BOARD_HOST, FEED_HOST]);

// The XML feed inlines every job's FULL HTML description, so it is large and
// slow by construction rather than occasionally: Tyler Technologies returns
// 1.88 MB for 236 jobs in ~11s. That overshoots the shared 10s default in
// _http.mjs by a second, which aborted the whole tenant and reported it as a
// network failure. Sized to absorb a genuinely big tenant on a slow link; the
// board page (a normal HTML document) keeps the default.
const FEED_TIMEOUT_MS = 45_000;

/**
 * Pin a URL to the two known Jobvite hosts over HTTPS.
 * @param {string} url
 */
function assertJobviteHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobvite: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:')
    throw new Error(`jobvite: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname))
    throw new Error(`jobvite: untrusted hostname "${parsed.hostname}" — must be ${BOARD_HOST} or ${FEED_HOST}`);
  return url;
}

// NaN-safe Date.parse → epoch ms.
/** @param {string} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The vanity slug from a Jobvite careers URL, or null.
 * Only used to build the board URL for eId discovery.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveSlug(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== BOARD_HOST) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (!segments.length || segments[0] === 'api') return null;
  return segments[0];
}

/**
 * The companyEId from explicit config, without touching the network.
 * Returns null when the entry only carries a vanity slug.
 *
 * @param {import('./_types.js').PortalEntry & {company_eid?: string}} entry
 * @returns {string | null}
 */
export function resolveConfiguredEid(entry) {
  const direct = typeof entry.company_eid === 'string' ? entry.company_eid.trim() : '';
  if (direct) return direct;

  const api = typeof entry.api === 'string' ? entry.api.trim() : '';
  if (!api) return null;
  let parsed;
  try {
    parsed = new URL(api);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) return null;
  const c = parsed.searchParams.get('c');
  return c && c.trim() ? c.trim() : null;
}

/**
 * Scrape `companyEId` out of a Jobvite board page.
 *
 * The board embeds it in inline JS as `companyEId: 'q6NaVfwI'`. Quoting and
 * spacing vary between tenants, hence the tolerant pattern. Exported so the
 * scrape can be unit-tested without a network call.
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractEidFromBoard(html) {
  if (typeof html !== 'string' || !html) return null;
  const m = html.match(/companyEId\s*[:=]\s*['"]([A-Za-z0-9_-]{4,40})['"]/);
  return m ? m[1] : null;
}

/** @param {string} eid */
function buildFeedUrl(eid) {
  const u = new URL(`https://${FEED_HOST}/CompanyJobs/Xml.aspx`);
  u.searchParams.set('c', eid);
  return u.href;
}

/** @param {string} slug */
function buildBoardUrl(slug) {
  return `https://${BOARD_HOST}/${encodeURIComponent(slug)}`;
}

/** @type {Provider} */
export default {
  id: 'jobvite',

  detect(entry) {
    const eid = resolveConfiguredEid(entry);
    if (eid) return { url: buildFeedUrl(eid) };
    // A vanity URL alone still identifies this provider; the eId is resolved
    // at fetch time via discovery.
    const slug = resolveSlug(entry);
    return slug ? { url: buildBoardUrl(slug) } : null;
  },

  async fetch(entry, ctx) {
    let eid = resolveConfiguredEid(entry);

    if (!eid) {
      const slug = resolveSlug(entry);
      if (!slug) throw new Error(`jobvite: cannot derive a company id for ${entry.name} — set company_eid: or an api: URL with ?c=`);
      const boardUrl = buildBoardUrl(slug);
      assertJobviteHost(boardUrl);
      const html = await ctx.fetchText(boardUrl, { redirect: 'error' });
      eid = extractEidFromBoard(html);
      if (!eid) {
        throw new Error(
          `jobvite: could not find companyEId on ${boardUrl} for ${entry.name}. ` +
          `Set it explicitly with company_eid: (find it in the board page source as companyEId: '…').`,
        );
      }
    }

    const feedUrl = buildFeedUrl(eid);
    assertJobviteHost(feedUrl);
    const xml = await ctx.fetchText(feedUrl, { redirect: 'error', timeoutMs: FEED_TIMEOUT_MS });
    return parseJobviteXml(xml, entry.name);
  },
};

/**
 * Read one tag out of a `<job>` block, unwrapping CDATA.
 *
 * Deliberately index-based rather than a regex. The obvious pattern here —
 * `<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*</name>` — puts `\s*` either
 * side of a lazy `[\s\S]*?`, which is polynomial-backtracking on input that
 * never closes the tag, and this parser runs on a remote 1.9 MB document.
 * CodeQL flags it (js/polynomial-redos, high) and it is right to. Scanning with
 * indexOf is linear, allocation-light and easier to read.
 *
 * @param {string} block
 * @param {string} name
 */
function tagText(block, name) {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = block.indexOf(open);
  if (start === -1) return '';
  const from = start + open.length;
  const end = block.indexOf(close, from);
  if (end === -1) return '';

  let value = block.slice(from, end).trim();
  if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) {
    value = value.slice('<![CDATA['.length, -']]>'.length).trim();
  }
  return value;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode the XML entities that appear in this feed.
 *
 * Numeric references matter here and are not decorative: Jobvite titles carry
 * typographic punctuation from the source ATS — `&#8217;` (right single quote)
 * and `&#x2013;` (en dash) both appear in real postings. Leaving them raw puts
 * literal `&#8217;` into a job title, which then reaches the tracker and any
 * generated document.
 *
 * @param {string} s
 */
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Reject non-characters rather than emitting U+FFFD or throwing.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return XML_ENTITIES[/** @type {keyof typeof XML_ENTITIES} */ (body)] ?? match;
  });
}

/**
 * Parse a Jobvite `CompanyJobs/Xml.aspx` feed. Exported for unit tests.
 *
 * Field mapping:
 *   title    ← `<title>`                          (required; posting dropped when absent)
 *   url      ← `<detail-url>`, else `<apply-url>` (required; must be http(s))
 *   company  ← `entry.name`                       (the feed carries no company name)
 *   location ← `<location>`
 *   postedAt ← `<date>` (M/D/YYYY) → epoch ms     (omitted when absent/unparseable)
 *
 * `<detail-url>` is preferred over `<apply-url>` because it is the human-readable
 * posting page; the apply URL jumps straight into the application form, which is
 * a worse thing to write into the pipeline for a human to open.
 *
 * Feed URLs arrive as http: in practice. They are display-only — never fetched
 * here — so they are upgraded to https: rather than dropped, which would
 * discard every posting in the feed.
 *
 * @param {string} xml
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseJobviteXml(xml, companyName) {
  if (typeof xml !== 'string' || !xml) return [];

  const out = [];
  for (const m of xml.matchAll(/<job>([\s\S]*?)<\/job>/gi)) {
    const block = m[1];

    const title = decodeEntities(tagText(block, 'title'));
    if (!title) continue;

    // Try detail-url first, then apply-url. Each candidate is VALIDATED before
    // the next is considered: picking the string with `||` and validating once
    // means a present-but-malformed detail-url discards the posting even when a
    // perfectly good apply-url sits beside it.
    let url = '';
    for (const candidate of [tagText(block, 'detail-url'), tagText(block, 'apply-url')]) {
      if (!candidate) continue;
      try {
        const p = new URL(decodeEntities(candidate));
        if (p.protocol === 'http:') p.protocol = 'https:';
        if (p.protocol === 'https:') { url = p.href; break; }
      } catch {
        // malformed — fall through to the next candidate
      }
    }
    if (!url) continue;

    const location = decodeEntities(tagText(block, 'location'));

    /** @type {import('./_types.js').Job & {postedAt?: number}} */
    const job = { title, url, company: companyName, location };
    const postedAt = toEpochMs(tagText(block, 'date'));
    if (postedAt !== undefined) job.postedAt = postedAt;

    out.push(job);
  }
  return out;
}
