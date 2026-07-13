// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';

// Heckler & Koch provider — single-company (pattern: ibm/dassault/rheinmetall).
// The vacancy list at heckler-koch.com/de/Karriere/Stellenangebote is a Nuxt
// page whose job cards are SERVER-rendered, so a single bare-HTTP GET returns
// every posting (small board, ~32 roles, all in Oberndorf a. N. / Vöhringen).
// The apply backend lives on karriere.heckler-koch.com/jobposting/{hash}; the
// listing links straight to it, so that hash is our stable id + job URL.
//
// Card markup:
//   <a href="https://karriere.heckler-koch.com/jobposting/{hash}" …>
//     <div class="text-secondary font-medium">
//       <p> {Field} | {Type} </p>
//       <h3 class="text-lg md:text-2xl">{Title}</h3>
//     </div> …
//   </a>
//
// The list carries no explicit location or date; H&K is effectively
// single-site (Oberndorf), and titles often name the site, so we leave location
// empty rather than guess. detect() claims the heckler-koch.com host.

const MAX_JOBS = 500; // generous cap; the board is tiny

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Resolve the vacancy-list URL from api:/careers_url; default the DE list. */
export function resolveListUrl(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.host.toLowerCase();
  if (host !== 'heckler-koch.com' && !host.endsWith('.heckler-koch.com')) return null;
  // A Stellenangebote path passes through; anything else on the host defaults.
  if (/Stellenangebote/i.test(u.pathname)) return `${u.origin}${u.pathname}`;
  return `${u.origin}/de/Karriere/Stellenangebote`;
}

/**
 * Parse the SSR listing into raw {id, title, url} records. Anchors on the
 * karriere.heckler-koch.com/jobposting/{hash} link (the stable id + URL), then
 * reads the sibling <h3> title inside the same anchor.
 * @param {string} html
 */
export function parseListing(html) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="(https:\/\/karriere\.heckler-koch\.com\/jobposting\/([a-z0-9]+))"[\s\S]*?<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = decodeEntities(m[1]);
    const id = m[2];
    if (seen.has(id)) continue;
    const block = m[0];
    const titleM = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleM ? clean(titleM[1]) : '';
    if (!title) continue;
    seen.add(id);
    out.push({ id, title, url });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'hecklerkoch',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    return resolveListUrl({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const listUrl = resolveListUrl(entry);
    if (!listUrl) throw new Error(`hecklerkoch: cannot resolve vacancy list for ${entry.name}`);
    const html = await ctx.fetchText(listUrl, { headers: { accept: 'text/html' } });
    const rows = parseListing(html);
    const jobs = [];
    for (const row of rows) {
      jobs.push({ title: row.title, url: row.url, company: entry.name, location: '' });
      if (jobs.length >= MAX_JOBS) break;
    }
    return jobs;
  },
};
