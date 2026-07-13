// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Rheinmetall provider — single-company (like ibm.mjs / dassault.mjs). The
// public vacancy list at https://www.rheinmetall.com/{lang}/career/vacancies is
// a Nuxt app whose job cards are SERVER-RENDERED into the HTML — plain
// `?page=N` pagination works over bare HTTP (verified: distinct postings per
// page, ~10 unique jobs/page, "of 1348" total at time of writing). No XHR API
// is exposed; the underlying Cornerstone TalentLink tenant
// (rheinmetall.recruitmentplatform.com) has no anonymous REST endpoint either
// (apply-app/fo/srp probes all 404), so parsing the SSR list is the zero-token
// path.
//
// Card markup (one card per posting, three <a> copies of the same link inside):
//   <div class="flex gap-0.5 group">
//     <a href="/en/job/{slug}/{id}" …>…</a>
//     … <div class="text-sm font-bold md:text-xl mb-2">{Title}</div> …
//     … <div class="flex flex-wrap mr-6"> {Company GmbH} | {City} </div> …
//   </div>
// We split on the card wrapper and read each field within one card only —
// pairing fields across card boundaries (the naive regex approach) attributes
// the NEXT card's title to the previous card's id.
//
// The list carries no posting date; postedAt is omitted (consumers treat an
// absent date as "unknown", never as stale).

const MAX_PAGES = 150; // safety cap (~1350 postings at 10/page); tune via entry.max_pages
const MAX_JOBS = 1500; // cap total postings pulled
const PAGE_DELAY_MS = 150; // polite pacing — full walks are >100 sequential requests

// Minimal HTML entity decoder — titles carry named (&amp;) and numeric
// (&#252; / &#xfc;) entities. Mirrors successfactors.mjs / dassault.mjs.
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

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Resolve the list URL (entry.api / careers_url) or the /en default. */
export function resolveListUrl(entry) {
  const raw = entry.api || entry.careers_url || '';
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase();
    if (host !== 'rheinmetall.com' && !host.endsWith('.rheinmetall.com')) return null;
    if (/\/career\/vacancies\/?$/.test(u.pathname)) return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
    // Any other rheinmetall.com URL (e.g. the branded career hub) → EN default.
    return `${u.origin}/en/career/vacancies`;
  } catch {
    return null;
  }
}

/**
 * Parse one SSR vacancy page into raw {id, title, url, location} records.
 * @param {string} html @param {string} origin
 */
export function parseVacancies(html, origin) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  // Card wrapper split; slice(0) is the page head before the first card.
  const blocks = html.split(/<div class="flex gap-0\.5 group">/).slice(1);
  for (const block of blocks) {
    const link = block.match(/href="(\/[a-z]{2}\/job\/[^"]+\/(\d+))"/);
    if (!link) continue;
    const id = link[2];
    if (seen.has(id)) continue;
    // Title div: the md:text-xl card headline. Fall back to the URL slug when
    // the markup shifts, so a styling change degrades titles instead of
    // dropping postings.
    const titleM = block.match(/md:text-xl[^"]*">([\s\S]*?)<\/div>/);
    const title = titleM ? clean(titleM[1]) : clean(decodeURIComponent(link[1].split('/')[3] || '').replace(/_/g, ' '));
    if (!title) continue;
    // "{Company GmbH} | {City}" line; the city is what location filters need.
    const orgM = block.match(/class="flex flex-wrap mr-6">([\s\S]*?)<\/div>/);
    const org = orgM ? clean(orgM[1]) : '';
    const city = org.includes('|') ? org.split('|').pop().trim() : '';
    seen.add(id);
    out.push({ id, title, url: origin + link[1], location: city });
  }
  return out;
}

/** Resolve the page cap: positive integer `max_pages`, else default. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'rheinmetall',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    return resolveListUrl({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const listUrl = resolveListUrl(entry);
    if (!listUrl) throw new Error(`rheinmetall: cannot resolve vacancies URL for ${entry.name}`);
    const origin = new URL(listUrl).origin;

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await wait(PAGE_DELAY_MS);
      const html = await ctx.fetchText(`${listUrl}?page=${page}`, {
        headers: { accept: 'text/html' },
      });
      const rows = parseVacancies(html, origin);
      if (rows.length === 0) {
        if (page === 1) console.warn(`rheinmetall: page 1 returned no vacancy cards for ${entry.name} — markup may have changed`);
        break; // past the last page
      }

      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
      }
      // No new ids → the server clamped ?page= to the last page (or looped). Stop.
      if (fresh === 0) break;
      if (jobs.length >= MAX_JOBS) break;
    }
    return jobs.slice(0, MAX_JOBS);
  },
};
