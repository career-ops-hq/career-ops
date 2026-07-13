// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Dassault Systèmes provider — hits the public Exalead "card search" API that
// powers www.3ds.com/careers/jobs. Single-company provider (like ibm.mjs): the
// endpoint is global to 3ds.com, so there's no per-tenant config.
//
//   GET https://www.3ds.com/apisearch/card_search_api
//       ?lang=en
//       &r=f/card_content_type/career                          # only career cards
//       &r=f/card_content_categories_facet/cards language/en   # only the English copy
//       &start={offset}                                        # 0-based, 10 hits/page
//
// The response is Exalead XML (Content-Type: application/javascript), not JSON.
// We don't need a real XML parser — each posting is one <Hit>…</Hit> block whose
// fields are <Meta name="…"><MetaString name="value">…</MetaString> pairs.
//
// Why BOTH refinements matter (learned the hard way):
//   * The `type=career` URL shorthand returns a *global* career-content index
//     (~43k hits) where Dassault's own jobs are a small minority ranked first and
//     the rest is third-party aggregated content (bcit.ca, dejobs.org, …). Using
//     the proper `f/card_content_type/career` facet instead narrows to Dassault's
//     own postings (5340 hits, every cta_1 URL on 3ds.com).
//   * Without the language refinement each job is duplicated across ~12 languages.
//     `cards language/en` collapses that to the 445 English postings.
// As a safety net we still keep only hits whose public URL is on *.3ds.com, so a
// future index change can't leak foreign postings back in.
//
// The Taleo apply backend (talentacquisition.3ds.com) is out of scope — we list
// from Exalead and link to the public 3ds.com job page.

const BASE = 'https://www.3ds.com/apisearch/card_search_api';
const REFINES = ['f/card_content_type/career', 'f/card_content_categories_facet/cards language/en'];
const PAGE_SIZE = 10; // Exalead returns 10 hits/page
const MAX_PAGES = 60; // safety cap on request count (~600 postings; the en set is ~445)
const MAX_JOBS = 1000; // cap total postings pulled

/** @param {number} start */
export function buildUrl(start) {
  const p = new URLSearchParams();
  p.set('lang', 'en'); // keeps facet labels (Country/City/…) in English
  for (const r of REFINES) p.append('r', r);
  p.set('start', String(start));
  return `${BASE}?${p.toString()}`;
}

// Minimal HTML entity decoder — titles/URLs/locations carry named (&amp;, &apos;)
// and numeric (&#252; / &#xfc;) entities. Mirrors successfactors.mjs.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

// Pull every <Meta name="X"><MetaString name="value">V</MetaString> pair from one
// <Hit> block into a Map. First value per name wins.
/** @param {string} hitXml @returns {Map<string,string>} */
function metaMap(hitXml) {
  const map = new Map();
  const re = /<Meta name="([^"]+)"[^>]*>\s*<MetaString[^>]*name="value"[^>]*>([\s\S]*?)<\/MetaString>/g;
  let m;
  while ((m = re.exec(hitXml)) !== null) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

// content_categories is a flat "Label/Value Label/Value …" string. Values can hold
// spaces and commas ("United Kingdom, Cambridge"), so we can't split on whitespace —
// we anchor on the known label tokens and slice each value up to the next label.
// Labels come back localized even at lang=en in some responses (the API has been
// seen emitting Spanish País/Ciudad), so we accept the common locale variants.
const LOC_LABELS = [
  'Category', 'Type', 'Country', 'City', 'Products', 'Year', // en
  'Categoría', 'Categoria', 'Tipo', 'País', 'Pais', 'Ciudad', 'Productos', 'Año', 'Ano', 'Área', 'Area', // es
  'Catégorie', 'Pays', 'Ville', 'Produits', 'Année', 'Annee', // fr
];
const CITY_LABELS = new Set(['City', 'Ciudad', 'Ville']);
const COUNTRY_LABELS = new Set(['Country', 'País', 'Pais', 'Pays']);
const LABEL_RE = new RegExp('(^|\\s)(' + LOC_LABELS.join('|') + ')\\/', 'g');

/** @param {string} categories @returns {{city: string, country: string}} */
function parseCategories(categories) {
  const marks = [];
  let m;
  LABEL_RE.lastIndex = 0;
  while ((m = LABEL_RE.exec(categories)) !== null) {
    marks.push({ label: m[2], keyStart: m.index + m[1].length, valStart: m.index + m[0].length });
  }
  let city = '';
  let country = '';
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].keyStart : categories.length;
    const value = decodeEntities(categories.slice(marks[i].valStart, end)).trim();
    if (!city && CITY_LABELS.has(marks[i].label)) city = value;
    else if (!country && COUNTRY_LABELS.has(marks[i].label)) country = value;
  }
  return { city, country };
}

// "2026/07/03 18:22:13" → epoch ms (parsed as UTC so it's deterministic across
// machine timezones; the API doesn't state a zone, and consumers only use this
// for coarse recency ranking).
/** @param {string} ts @returns {number | undefined} */
function toEpochMs(ts) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((ts || '').trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Parse one Exalead card-search XML page into normalized jobs.
 * Deduped by card_id within the page; the fetch loop dedups again across pages.
 * Keeps only real Dassault-hosted postings (public URL on *.3ds.com).
 * @param {string} xml @param {string} entryName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number, _id: string}>}
 */
export function parseHits(xml, entryName) {
  const hits = typeof xml === 'string' ? xml.match(/<Hit\b[\s\S]*?<\/Hit>/g) : null;
  if (!hits) return [];

  const byId = new Map();
  for (const hit of hits) {
    const meta = metaMap(hit);
    const title = decodeEntities((meta.get('content_title') || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const url = decodeEntities((meta.get('content_cta_1_url') || '').trim());
    if (!title || !url) continue;

    // Safety net: only accept postings hosted on 3ds.com. The refined query
    // already guarantees this, but a broadened index must never leak through.
    let host;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      continue;
    }
    if (host !== '3ds.com' && !host.endsWith('.3ds.com')) continue;

    const { city, country } = parseCategories(meta.get('content_categories') || '');
    const postedAt = toEpochMs(meta.get('content_start_datetime') || meta.get('card_update_timestamp') || '');
    // card_id is the natural dedup key; fall back to the URL when absent.
    const id = (meta.get('card_id') || '').trim() || url;
    if (byId.has(id)) continue;

    const job = { title, url, company: entryName || 'Dassault Systèmes', location: city || country, _id: id };
    if (postedAt !== undefined) job.postedAt = postedAt;
    byId.set(id, job);
  }
  return [...byId.values()];
}

/** @type {Provider} */
export default {
  id: 'dassault',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    // Match the host, not a path segment, so evil.com/x.3ds.com can't spoof it.
    try {
      const host = new URL(url).host.toLowerCase();
      if (host === '3ds.com' || host.endsWith('.3ds.com')) return { url };
    } catch {
      /* not an absolute URL */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const jobs = [];
    const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const xml = await ctx.fetchText(buildUrl(page * PAGE_SIZE), {
        redirect: 'error',
        headers: { accept: 'application/xml, text/xml, */*' },
      });
      const parsed = parseHits(xml, entry.name);
      if (parsed.length === 0) break; // past the last page

      let fresh = 0;
      for (const job of parsed) {
        if (seen.has(job._id)) continue;
        seen.add(job._id);
        fresh++;
        const { _id, ...clean } = job; // drop the internal dedup key
        jobs.push(clean);
      }
      if (fresh === 0) break; // server ignored the offset / looped
      if (jobs.length >= MAX_JOBS) break;
    }
    return jobs;
  },
};
