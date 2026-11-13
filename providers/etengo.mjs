// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry } from './_http.mjs';

// Etengo provider: Etengo AG's IT freelance project list
// (https://www.etengo.de/it-projektsuche/). Etengo is an IT freelancer agency;
// its projects are for anonymous end clients, so this is one agency's own
// list. It is wired in through the `job_boards:` list of portals.yml (one
// entry, many end clients), not `tracked_companies:`.
//
// The page renders 12 project cards and loads the rest through
// `GET /?action=etengo/project/filter&zip=&branch=&text=` — the call its own
// filter box makes — which answers `{ items: [cardHtml, ...], totalCount }`
// with the whole list in one response (32 of 32 on 2026-10-28). So this
// provider makes exactly one request and has no pagination. robots.txt
// disallows only `/cpresources/` (checked 2026-10-28).
//
// Each card carries the title, the project id (CA-…), a masked postcode
// ("DE 7XXXX"), duration, start date and industry. The end client is never
// named, so `company` is "Etengo (agency, end client not named)", and every
// description starts with "Engagement: freelance (via Etengo AG)". Rates are
// not on the card and are never filled in. Applying is free.
//
//   job_boards:
//     - name: Etengo — IT-Projekte
//       provider: etengo
//       enabled: true

const ORIGIN = 'https://www.etengo.de';
const FILTER_URL = `${ORIGIN}/?action=etengo/project/filter&zip=&branch=&text=`;
const COMPANY_LABEL = 'Etengo (agency, end client not named)';
// A project link, the listing signal for the empty-vs-broken split.
const PROJECT_HREF_RE = /href="https:\/\/www\.etengo\.de\/it-projektsuche\/\d+\/?"/;

/** @param {string} s */
const plainText = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * `<small>Label</small> <span>value</span>` pairs on one card.
 * @param {string} html
 * @returns {Record<string, string>}
 */
function cardFields(html) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /<small>([\s\S]*?)<\/small>\s*<span>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) {
    const label = plainText(m[1]);
    const value = plainText(m[2]);
    if (label && value && !(label in out)) out[label] = value;
  }
  return out;
}

/**
 * "DE 7XXXX" → "Germany (postal area 7XXXX)". The postcode is masked by the
 * source; nothing beyond the country prefix is expanded.
 * @param {string} plz
 */
function buildLocation(plz) {
  if (!plz) return '';
  const m = plz.match(/^DE\s*(\S*)$/i);
  if (m) return m[1] && !/^X+$/i.test(m[1]) ? `Germany (postal area ${m[1]})` : 'Germany';
  return plz;
}

/**
 * Parses one project card. Returns null when it has no project link or title.
 * @param {any} html
 */
function parseCard(html) {
  if (typeof html !== 'string') return null;
  const a = html.match(/<a\b[^>]*href="(https:\/\/www\.etengo\.de\/it-projektsuche\/(\d+)\/?)"[^>]*>([\s\S]*?)<\/a>/i);
  if (!a) return null;
  const id = a[2];
  const title = plainText(a[3]);
  if (!title) return null;
  const f = cardFields(html);
  const parts = ['Engagement: freelance (via Etengo AG)'];
  if (f['Projekt-ID']) parts.push(`Projekt-ID: ${f['Projekt-ID']}`);
  if (f.Laufzeit) parts.push(`Laufzeit: ${f.Laufzeit}`);
  if (f.Start) parts.push(`Start: ${f.Start}`);
  if (f.Branche) parts.push(`Branche: ${f.Branche}`);
  if (f.PLZ) parts.push(`PLZ: ${f.PLZ}`);
  return {
    title,
    url: `${ORIGIN}/it-projektsuche/${id}/`,
    company: COMPANY_LABEL,
    location: buildLocation(f.PLZ || ''),
    description: parts.join(' · '),
  };
}

/**
 * Parses the `etengo/project/filter` response. Exported for unit tests.
 *
 * Envelope: `{ items: [cardHtml, ...], totalCount }`. A missing or non-array
 * `items`, or a non-object body, throws; an empty `items` array is an empty
 * list. Cards with no project link or title are dropped — but if the items
 * carry project links and no card parses at all, the markup changed: throw.
 *
 * @param {any} json
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, description: string}>, total: number | null }}
 */
export function parseEtengoFilter(json) {
  const items = json && typeof json === 'object' && Array.isArray(json.items) ? json.items : null;
  if (!items) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`etengo: unexpected response — expected items[], got: [${got}]`);
  }
  /** @type {Map<string, any>} */
  const byUrl = new Map();
  for (const item of items) {
    const job = parseCard(item);
    if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
  }
  if (!byUrl.size && items.some((i) => typeof i === 'string' && PROJECT_HREF_RE.test(i))) {
    throw new Error('etengo: project links present but no project card parsed — markup changed');
  }
  const total = typeof json.totalCount === 'number' && Number.isFinite(json.totalCount) ? json.totalCount : null;
  return { jobs: [...byUrl.values()], total };
}

/** @type {Provider} */
export default {
  id: 'etengo',

  detect(entry) {
    return entry?.provider === 'etengo' ? { url: `${ORIGIN}/it-projektsuche/` } : null;
  },

  async fetch(entry, ctx) {
    const json = await fetchJsonWithRetry(ctx, FILTER_URL, {
      redirect: 'error',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    const { jobs, total } = parseEtengoFilter(json);
    if (total !== null && Array.isArray(json.items) && json.items.length < total) {
      console.warn(`etengo: "${entry?.name || 'Etengo'}" returned ${json.items.length} of ${total} projects; the list may be truncated`);
    }
    return jobs;
  },
};
