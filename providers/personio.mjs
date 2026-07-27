// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Personio provider — hits the public, no-auth XML jobs feed at
// `https://<slug>.jobs.personio.de/xml` (common across DACH/EU companies).
// Auto-detects from a `<slug>.jobs.personio.(de|com)` careers host like
// workable/recruitee. Per-tenant subdomains are the variable part, so the
// SSRF defence is an anchored host regex rather than a static allowlist.
//
// The feed is a flat, well-defined XML document, so it is parsed in-process
// with a tiny tag extractor (no new dependency — the repo ships none for XML).

const PERSONIO_HOST_RE = /^[a-z0-9][a-z0-9-]*\.jobs\.personio\.(de|com)$/;

/** @param {string} url */
function assertPersonioUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`personio: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`personio: URL must use HTTPS: ${url}`);
  if (!PERSONIO_HOST_RE.test(parsed.hostname))
    throw new Error(`personio: untrusted hostname "${parsed.hostname}" — must match <slug>.jobs.personio.(de|com)`);
  return url;
}

/**
 * Resolve the tenant host (e.g. `acme.jobs.personio.de`) from a careers_url.
 * Returns null for non-Personio or malformed URLs.
 * @param {import('./_types.js').PortalEntry} entry
 */
function resolveHost(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!PERSONIO_HOST_RE.test(parsed.hostname)) return null;
  return parsed.hostname;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */
export default {
  id: 'personio',

  detect(entry) {
    const host = resolveHost(entry);
    return host ? { url: `https://${host}/xml` } : null;
  },

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    if (!host) throw new Error(`personio: cannot derive feed URL for ${entry.name}`);
    const feedUrl = `https://${host}/xml`;
    assertPersonioUrl(feedUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertPersonioUrl above it guarantees the final hostname stays in-domain.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parsePersonioXml(text, entry.name, host);
  },
};

function fromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// Decode the XML entities that appear in Personio job text: numeric (&#38; /
// &#x27;) and the named five. Numeric forms are decoded first; &amp; is decoded
// LAST so a literal "&amp;lt;" yields "&lt;" rather than over-decoding to "<".
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

// Extract the text of the first <tag>…</tag> in a block. Returns '' when absent.
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? extractText(m[1]) : '';
}

/**
 * Parse Personio's public XML jobs feed. Exported for unit tests.
 *
 * Shape: `<workzag-jobs><position>…</position>…</workzag-jobs>`, each position
 * carrying `<id>`, `<name>`, `<office>` (+ optional `<additionalOffices><office>`),
 * and `<createdAt>` (ISO 8601). The feed has NO per-job URL, so it is built from
 * the already-validated tenant host: `https://<host>/job/<id>`.
 *
 * - title: `<name>` (required — positions without one are dropped).
 * - url: `https://<host>/job/<id>` — only when `<id>` is a plain integer, so a
 *   malformed id can never inject into the URL. url is the dedup key; a position
 *   without a usable id is dropped.
 * - location: every `<office>` in the block (primary + additionalOffices),
 *   de-duplicated, joined with ", ".
 * - postedAt: `<createdAt>` → epoch ms (omitted when unparseable/absent).
 *
 * @param {string} xml — raw XML feed body
 * @param {string} companyName — value written into job.company
 * @param {string} host — validated tenant host, e.g. `acme.jobs.personio.de`
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parsePersonioXml(xml, companyName, host) {
  if (typeof xml !== 'string') return [];
  const jobs = [];
  // Strip every <jobDescriptions> subtree from the WHOLE feed before splitting
  // into <position> blocks: descriptions are free-text HTML that can carry a
  // literal "</position>" which would otherwise truncate the non-greedy block
  // match. It also drops the per-section <name>/<value> pairs whose nested
  // <name> would race the position's own <name> (same for any other scalar tag).
  const stripped = xml.replace(/<jobDescriptions\b[^>]*>[\s\S]*?<\/jobDescriptions>/gi, '');
  const blocks = stripped.match(/<position\b[^>]*>[\s\S]*?<\/position>/g) || [];
  for (const scalar of blocks) {
    const title = tagText(scalar, 'name');
    if (!title) continue;

    const id = tagText(scalar, 'id');
    if (!/^\d+$/.test(id)) continue; // need a clean numeric id to build the url

    // Collect every <office> (primary + additionalOffices), de-dupe, join.
    const offices = [];
    const seen = new Set();
    for (const om of scalar.matchAll(/<office\b[^>]*>([\s\S]*?)<\/office>/g)) {
      const name = extractText(om[1]);
      if (name && !seen.has(name)) {
        seen.add(name);
        offices.push(name);
      }
    }

    jobs.push({
      title,
      url: `https://${host}/job/${id}`,
      location: offices.join(', '),
      company: companyName,
      postedAt: toEpochMs(tagText(scalar, 'createdAt')),
    });
  }
  return jobs;
}
