// @ts-check
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// Personio provider for public, no-auth `<slug>.jobs.personio.(de|com)` career
// sites (common across DACH/EU companies), auto-detected from that careers
// host. Per-tenant subdomains are the variable part, so the SSRF defence is an
// anchored host regex rather than a static allowlist.
//
// A tenant serves its postings on three public pages:
//
//   /           the careers page. Server-rendered; its Next.js payload lists
//               every posting with its `available_languages` and the language
//               this response rendered it in.
//   /xml        the documented XML feed. Some tenants disable it.
//   /job/<id>   one posting's page, the URL each Job carries.
//
// A posting can be published in several languages. Each of these pages
// renders one of them, chosen by a `?language=` param (Accept-Language is
// ignored). Without the param, `/` and `/job/<id>` render a posting in its own
// default language, while `/xml` renders every posting in the tenant's
// language. So `/` is the primary source, and each Job is one language version
// of a posting, with URL `/job/<id>?language=<code>`:
//
// - Default: one fetch of `/`, each posting in its own default language. A
//   `?language=xx` on careers_url asks for that language instead, wherever a
//   posting has it.
// - `ctx.dedupIncludeLanguage` (scan_history.dedup_include_language): one more
//   fetch of `/` per further language, so every version comes back; each
//   posting's default-language version first, which scan.mjs's language-aware
//   URL dedup relies on.
//
// The payload is undocumented, so when `/` yields nothing (fetch failure, or a
// changed page build) the provider falls back to `/xml`, parsed in-process
// with a tiny tag extractor, and to the job links on `/` when the tenant has
// the feed disabled.

const PERSONIO_HOST_RE = /^[a-z0-9][a-z0-9-]*\.jobs\.personio\.(de|com)$/;

// The query param every Personio page takes its rendering language from.
const LANGUAGE_PARAM = 'language';

// A language code as Personio writes it (`de`, `en`). Codes from the payload
// and from careers_url go into request and job URLs verbatim, so this gate
// keeps them to tag characters; scan.mjs canonicalizes them for comparison.
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

// Spacing between the per-language careers-page fetches of one tenant.
const INTER_LANGUAGE_DELAY_MS = 200;

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
const PERSONIO_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

function resolveHost(entry) {
  // An explicit `personio: <slug>` pins the tenant directly. Needed because many
  // companies embed the Personio tenant as an iframe on a branded careers page,
  // so careers_url points at the company domain while the feed lives at
  // <slug>.jobs.personio.de. The slug is charset-restricted here and the
  // resulting URL still goes through assertPersonioUrl(), so the host allowlist
  // and HTTPS check below remain the only way a request URL is accepted.
  if (typeof entry.personio === 'string') {
    const slug = entry.personio.trim();
    if (PERSONIO_SLUG_RE.test(slug)) return `${slug}.jobs.personio.de`;
  }
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

/**
 * The language a Personio careers_url asks for (`?language=xx`), or null.
 * @param {import('./_types.js').PortalEntry} entry
 */
function preferredLanguage(entry) {
  if (typeof entry.careers_url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(entry.careers_url);
  } catch {
    return null;
  }
  if (!PERSONIO_HOST_RE.test(parsed.hostname)) return null;
  const language = (parsed.searchParams.get(LANGUAGE_PARAM) || '').trim().toLowerCase();
  return LANGUAGE_RE.test(language) ? language : null;
}

/**
 * The query string asking a Personio page for `language`; '' for none.
 * @param {string|null} language - Already checked against LANGUAGE_RE.
 */
function languageQuery(language) {
  return language ? `?${LANGUAGE_PARAM}=${language}` : '';
}

/** @param {string} host @param {string|null} language */
function careersPageUrl(host, language) {
  return assertPersonioUrl(`https://${host}/${languageQuery(language)}`);
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
    const allLanguages = ctx.dedupIncludeLanguage === true;
    // Every language is fetched anyway, so the first fetch is the defaults one:
    // it is what puts each posting's default-language version first.
    const language = allLanguages ? null : preferredLanguage(entry);

    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertPersonioUrl it guarantees the final hostname stays in-domain.
    let page = null;
    try {
      page = await fetchTextWithRetry(ctx, careersPageUrl(host, language), { redirect: 'error' });
    } catch {
      // Falls through to the XML feed, which answers for the tenant itself.
    }
    const postings = page === null ? [] : parsePersonioListing(page);
    if (postings.length > 0) {
      const versions = postings.map(posting => [posting]);
      if (allLanguages) await addLanguageVersions(host, postings, versions, ctx);
      return versions.flat()
        .map(posting => listingPostingToJob(posting, entry.name, host))
        .filter(job => job !== null);
    }

    const feedUrl = assertPersonioUrl(`https://${host}/xml${languageQuery(language)}`);
    try {
      const text = await fetchTextWithRetry(ctx, feedUrl, { redirect: 'error' });
      return parsePersonioXml(text, entry.name, host);
    } catch (err) {
      // A 404 is never retried, so it arrives here on the first attempt.
      if (err?.status !== 404) throw err;
      // Some tenants disable the public XML feed; the careers page still links
      // every job in its initial HTML.
      const html = page ?? await fetchTextWithRetry(ctx, careersPageUrl(host, language), { redirect: 'error' });
      return parsePersonioHtml(html, entry.name, host);
    }
  },
};

/**
 * Fetch the careers page once per language some posting has beyond the one it
 * was first rendered in, and append each posting's version in that language to
 * its entry in `versions`. Best-effort: a language whose fetch fails is skipped
 * and the versions already collected stand.
 *
 * @param {string} host
 * @param {ListingPosting[]} postings - From the defaults fetch.
 * @param {ListingPosting[][]} versions - Parallel to `postings`; appended to.
 * @param {any} ctx
 */
async function addLanguageVersions(host, postings, versions, ctx) {
  const indexById = new Map(postings.map((posting, i) => [posting.id, i]));
  const languages = [...new Set(postings.flatMap(posting =>
    posting.availableLanguages.filter(language => language !== posting.currentLocale)))].sort();
  for (const [n, language] of languages.entries()) {
    if (n > 0) await sleep(INTER_LANGUAGE_DELAY_MS, ctx);
    let page;
    try {
      page = await fetchTextWithRetry(ctx, careersPageUrl(host, language), { redirect: 'error' });
    } catch {
      continue;
    }
    for (const posting of parsePersonioListing(page)) {
      const i = indexById.get(posting.id);
      // A posting without this language comes back in its default one, which
      // the defaults fetch already holds.
      if (i === undefined || posting.currentLocale !== language) continue;
      if (postings[i].currentLocale === language) continue;
      versions[i].push(posting);
    }
  }
}

/**
 * @param {ListingPosting} posting
 * @param {string} companyName
 * @param {string} host
 */
function listingPostingToJob(posting, companyName, host) {
  if (!posting.name) return null;
  const language = posting.currentLocale;
  const offices = [...new Set([posting.mainOffice, ...posting.additionalOffices].filter(Boolean))];
  return {
    title: posting.name,
    url: `https://${host}/job/${posting.id}${languageQuery(language)}`,
    location: offices.join(', '),
    company: companyName,
    postedAt: toEpochMs(posting.createdAt),
    ...(language ? { language } : {}),
  };
}

/**
 * @typedef {object} ListingPosting
 * @property {string} id
 * @property {string} name
 * @property {string} mainOffice
 * @property {string[]} additionalOffices
 * @property {string} createdAt
 * @property {string[]} availableLanguages
 * @property {string} currentLocale - The language this page rendered it in; '' when unreadable.
 */

/**
 * Parse the postings out of a careers page's Next.js payload. Exported for unit
 * tests.
 *
 * The page streams its React Server Component payload as
 * `self.__next_f.push([1,"<chunk>"])` scripts; the chunks are JSON string
 * literals that concatenate into one text, in which each posting is a JSON
 * object starting `{"id":"<digits>"` and carrying `available_languages`. Only
 * objects that parse as JSON and have a numeric id, a name and that array are
 * kept, so the unrelated objects sharing the `id` key never pass.
 *
 * @param {string} html - careers page HTML body
 * @returns {ListingPosting[]} In page order, one per id; empty when nothing parses.
 */
export function parsePersonioListing(html) {
  if (typeof html !== 'string') return [];
  let payload = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const chunk = JSON.parse(m[1]);
      if (chunk[0] === 1 && typeof chunk[1] === 'string') payload += chunk[1];
    } catch {
      // Not a data chunk.
    }
  }
  const postings = [];
  const seen = new Set();
  let from = 0;
  for (;;) {
    const start = payload.indexOf('{"id":"', from);
    if (start === -1) break;
    const end = jsonObjectEnd(payload, start);
    from = start + 1;
    if (end === -1) continue;
    let raw;
    try {
      raw = JSON.parse(payload.slice(start, end));
    } catch {
      continue;
    }
    const posting = toListingPosting(raw);
    if (!posting || seen.has(posting.id)) continue;
    seen.add(posting.id);
    postings.push(posting);
    from = end;
  }
  return postings;
}

/** @param {any} raw @returns {ListingPosting|null} */
function toListingPosting(raw) {
  if (!raw || typeof raw.id !== 'string' || !/^\d+$/.test(raw.id)) return null;
  if (typeof raw.name !== 'string' || !Array.isArray(raw.available_languages)) return null;
  const languageOf = (value) => {
    const language = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return LANGUAGE_RE.test(language) ? language : '';
  };
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    id: raw.id,
    name: text(raw.name),
    mainOffice: text(raw.main_office),
    additionalOffices: Array.isArray(raw.additional_offices) ? raw.additional_offices.map(text).filter(Boolean) : [],
    createdAt: text(raw.created_at),
    availableLanguages: raw.available_languages.map(languageOf).filter(Boolean),
    currentLocale: languageOf(raw.current_locale),
  };
}

/**
 * Index just past the JSON object opening at `start`, or -1 when it never
 * closes. Braces inside string literals are skipped.
 *
 * @param {string} text
 * @param {number} start - Index of the opening `{`.
 */
function jsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(inner).trim();
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
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
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

/**
 * Last resort, for a tenant whose /xml feed is disabled (404 there, 200 on the
 * page) when {@link parsePersonioListing} reads nothing from the same page.
 * The careers page is server-rendered by the same Personio frontend
 * build across tenants, so the job list is already present in the initial
 * HTML — no headless browser needed. Each job is an `<a href="/job/{id}">`
 * carrying the shared (non-hashed) marker class `job-box`, wrapping an
 * `<h3>` title and a `<span>` with the first location line. Class names use
 * hashed CSS module suffixes (e.g. `page_jobTitle__K0ilk`) that are build-
 * specific, not tenant-specific, so matching only on the stable `job-box` /
 * `jobMetaText` substrings keeps the regex independent of that hash.
 *
 * The job links carry no creation date, so postedAt is always omitted (unlike
 * parsePersonioXml's createdAt), and no language, so neither is `language`.
 *
 * @param {string} html — careers page HTML body
 * @param {string} companyName — value written into job.company
 * @param {string} host — validated tenant host, e.g. `acme.jobs.personio.de`
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parsePersonioHtml(html, companyName, host) {
  if (typeof html !== 'string') return [];
  const jobs = [];
  const seen = new Set();
  // href may carry a trailing query string, e.g. "/job/2560093?language=en"
  // when the page itself was fetched with ?language= — the numeric id is
  // still what we need, so the query part (if any) is matched and discarded.
  // class and href aren't guaranteed to appear in a fixed order on the
  // anchor, so the opening tag's attributes are captured as one blob and
  // checked independently rather than anchored on attribute order.
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = anchorRe.exec(html))) {
    const attrs = m[1];
    if (!/\bclass="[^"]*\bjob-box\b[^"]*"/.test(attrs)) continue;
    const hrefMatch = attrs.match(/\bhref="\/job\/(\d+)(?:\?[^"]*)?"/);
    if (!hrefMatch) continue;
    const id = hrefMatch[1];
    if (seen.has(id)) continue;
    const block = m[2];

    const titleMatch = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/);
    if (!titleMatch) continue;
    const title = decodeEntities(stripTags(titleMatch[1])).trim();
    if (!title) continue;

    const locMatch = block.match(/<span\b[^>]*class="[^"]*jobMetaText[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const location = locMatch ? decodeEntities(stripTags(locMatch[1])).trim() : '';

    seen.add(id);
    jobs.push({
      title,
      url: `https://${host}/job/${id}`,
      location,
      company: companyName,
    });
  }
  return jobs;
}
