// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// freelancermap provider: a freelance/contract project board (many posters,
// mostly IT agencies and end clients), so it goes in the `job_boards:` list of
// portals.yml.
//
// Two sites, one backend: freelancermap.de (DACH projects) and
// freelancermap.com (international projects; it excludes DACH by default).
// Both project search pages load their results from
// `POST /project/search/ajax?{query string}` (JSON), the same call the page's
// own search makes; no login is needed. robots.txt on both hosts is
// `User-agent: * / Disallow:` (empty), checked 2026-10-28.
//
// Inventory limit, stated plainly: for an anonymous visitor the source serves
// only the FIRST page (about 22 projects, newest first with `sort=1`) of any
// search — `pagenr` is ignored and the page asks you to register "um mehr
// Suchergebnisse zu sehen" (observed 2026-10-28). So this provider makes one
// request per query and never paginates; `max_pages` has no effect. Use
// several narrow `queries` (and `remote_only`) so each first page is the part
// of the board you care about, and scan often.
//
// Every description starts with "Engagement: …" taken from the posting's own
// contract type (contracting = freelance, employee leasing = ANÜ, permanent
// position). Rates are never filled in. Applying needs a freelancermap account;
// the page config links an upgrade for an application limit
// (`/upgrade?ref=application_limit`), so free accounts may be capped.
//
//   job_boards:
//     - name: freelancermap — AI projects (DACH)
//       provider: freelancermap
//       site: de               # 'de' (default, DACH) or 'com' (international)
//       queries: ["KI", "Machine Learning", "LLM"]  # optional; default: one
//                                                  #   unfiltered newest-first pass
//       remote_only: true      # optional; only projects marked 100 % remote
//       enabled: true

const SITES = {
  de: { origin: 'https://www.freelancermap.de', detailPrefix: '/projekt/', locale: 'de' },
  com: { origin: 'https://www.freelancermap.com', detailPrefix: '/project/', locale: 'en' },
};
const AJAX_PATH = '/project/search/ajax';
const MAX_QUERIES = 20;
const INTER_QUERY_DELAY_MS = 500;
const SNIPPET_CHARS = 400;

const ENGAGEMENT_LABELS = {
  contracting: 'freelance (contracting)',
  employee_leasing: 'employee leasing (ANÜ)',
  permanent_position: 'permanent position',
};

/**
 * @param {any} entry
 * @returns {'de' | 'com'}
 */
export function resolveSite(entry) {
  const raw = entry?.site;
  if (raw === undefined || raw === null || raw === '') return 'de';
  if (raw === 'de' || raw === 'com') return raw;
  throw new Error(`freelancermap: entry "${entry?.name || '(unnamed)'}" has site ${JSON.stringify(raw)}; use 'de' or 'com'`);
}

/**
 * The entry's search keywords: trimmed, de-duplicated, at most MAX_QUERIES.
 * No usable keyword means one unfiltered pass (`''`).
 * @param {any} entry
 * @returns {string[]}
 */
export function parseQueries(entry) {
  const raw = Array.isArray(entry?.queries) ? entry.queries : [];
  const list = [...new Set(raw.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()))];
  return list.length ? list.slice(0, MAX_QUERIES) : [''];
}

/** @param {'de'|'com'} site @param {string} query @param {boolean} remoteOnly */
export function buildSearchUrl(site, query, remoteOnly) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (remoteOnly) params.set('remoteInPercent[0]', '100');
  params.set('sort', '1'); // newest first
  return `${SITES[site].origin}${AJAX_PATH}?${params.toString()}`;
}

/** @param {any} v */
const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {string} s */
const plainText = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** @param {any} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The project page. `links.project` (`/projekt/{slug}`) when it has the
 * expected shape, else the `slug`; either is host-controlled, so the slug goes
 * through safeEncodeURIComponent and a bad one drops the posting.
 * @param {any} p @param {'de'|'com'} site
 */
function projectUrl(p, site) {
  const { origin, detailPrefix } = SITES[site];
  const link = str(p.links?.project);
  let slug = '';
  if (link.startsWith(detailPrefix) && /^[^/?#]+$/.test(link.slice(detailPrefix.length))) {
    slug = link.slice(detailPrefix.length);
    try { slug = decodeURIComponent(slug); } catch { /* keep the raw segment */ }
  } else {
    slug = str(p.slug);
  }
  if (!slug || slug === '.' || slug === '..') return '';
  const seg = safeEncodeURIComponent(slug);
  return seg === null ? '' : `${origin}${detailPrefix}${seg}`;
}

/** @param {any} p */
function remotePercent(p) {
  const v = p.projectContractType?.remoteInPercent;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/** @param {any} p @param {'de'|'com'} site */
function buildLocation(p, site) {
  const city = str(p.city);
  // English country names on both sites, so one location_filter fits both.
  const country = str(p.country?.nameEn) || str(p.country?.name);
  const place = (city && country && city.toLowerCase() !== country.toLowerCase() ? [city, country] : [city || country]).filter(Boolean).join(', ');
  const pct = remotePercent(p);
  const remote = pct === 100 ? 'Remote (100%)' : pct && pct > 0 ? `Remote ${pct}%` : '';
  return [place, remote].filter(Boolean).join(' · ');
}

/** @param {any} p @param {'de'|'com'} site */
function buildDescription(p, site) {
  const type = str(p.projectContractType?.type);
  const engagement = ENGAGEMENT_LABELS[/** @type {keyof typeof ENGAGEMENT_LABELS} */ (type)] || (type ? type.replace(/_/g, ' ') : 'freelance project (contract type not stated)');
  const parts = [`Engagement: ${engagement}`];
  const pct = remotePercent(p);
  if (pct !== null) parts.push(`Remote: ${pct}%`);
  const month = str(p.beginningMonth);
  const year = str(p.beginningYear);
  const start = /^\d{1,2}$/.test(month) && /^\d{4}$/.test(year) ? `${month.padStart(2, '0')}/${year}` : str(p.beginningText);
  if (start) parts.push(`Start: ${start}`);
  const duration = str(p.durationText);
  if (duration) parts.push(`Duration: ${duration}`);
  const lang = site === 'de' ? 'de' : 'en';
  const skills = Array.isArray(p.skills) ? p.skills.map((s) => str(s?.[lang]) || str(s?.en) || str(s?.de)).filter(Boolean) : [];
  if (skills.length) parts.push(`Skills: ${skills.join(', ')}`);
  let text = parts.join(' · ');
  const body = typeof p.description === 'string' ? plainText(p.description) : '';
  if (body) text += `\n\n${body.slice(0, SNIPPET_CHARS)}`;
  return text;
}

/**
 * Parses one `/project/search/ajax` response. Exported for unit tests.
 *
 * Envelope: `{ projects: [...], topProjects?: [...], count, ... }`. A missing
 * or non-array `projects`, or a non-object body, throws; an empty `projects`
 * array is an empty result. `topProjects` (boosted copies) are merged in and
 * de-duplicated by URL. Rows without a title or URL, and rows whose
 * applications are paused, are dropped.
 *
 * @param {any} json
 * @param {'de'|'com'} [site]
 * @returns {Array<{title: string, url: string, company: string, location: string, description: string, postedAt?: number}>}
 */
export function parseFreelancermapSearch(json, site = 'de') {
  const rows = json && typeof json === 'object' && Array.isArray(json.projects) ? json.projects : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`freelancermap: unexpected response — expected projects[], got: [${got}]`);
  }
  const top = Array.isArray(json.topProjects) ? json.topProjects : [];
  /** @type {Map<string, any>} */
  const byUrl = new Map();
  for (const p of [...rows, ...top]) {
    if (!p || typeof p !== 'object') continue;
    if (p.applicationsPaused === true) continue;
    const title = typeof p.title === 'string' ? plainText(p.title) : '';
    if (!title) continue;
    const url = projectUrl(p, site);
    if (!url || byUrl.has(url)) continue;
    const company = plainText(str(p.company) || str(p.poster?.company)) || 'freelancermap poster (not named)';
    /** @type {{title: string, url: string, company: string, location: string, description: string, postedAt?: number}} */
    const job = { title, url, company, location: buildLocation(p, site), description: buildDescription(p, site) };
    const postedAt = toEpochMs(p.created);
    if (postedAt !== undefined) job.postedAt = postedAt;
    byUrl.set(url, job);
  }
  return [...byUrl.values()];
}

/** @type {Provider} */
export default {
  id: 'freelancermap',

  detect(entry) {
    if (entry?.provider !== 'freelancermap') return null;
    const site = entry?.site === 'com' ? 'com' : 'de';
    return { url: `${SITES[site].origin}${AJAX_PATH}` };
  },

  async fetch(entry, ctx) {
    const site = resolveSite(entry);
    const queries = parseQueries(entry);
    const remoteOnly = entry?.remote_only === true;
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    // One list request per query; the probe gets ctx.maxPages of them in total.
    const runQueries = probing ? queries.slice(0, ctxMaxPages) : queries;
    const label = entry?.name || 'freelancermap';
    /** @type {Map<string, any>} */
    const byUrl = new Map();
    let lastError = null;
    let pagesRead = 0;

    for (let i = 0; i < runQueries.length; i++) {
      const query = runQueries[i];
      if (i > 0) await sleep(INTER_QUERY_DELAY_MS, ctx);
      try {
        const json = await fetchJsonWithRetry(ctx, buildSearchUrl(site, query, remoteOnly), {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ changed: ['query'] }),
          timeoutMs: 25_000,
        });
        const jobs = parseFreelancermapSearch(json, site);
        pagesRead++;
        for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
      } catch (err) {
        if (probing) throw err; // keep ProbePageBudgetReached identity
        lastError = err;
        console.warn(`freelancermap: "${label}" query ${JSON.stringify(query)} failed: ${err && err.message ? err.message : err}`);
      }
    }
    // Every query failed: fail loud rather than report an empty board.
    if (!pagesRead && lastError) throw lastError;
    return [...byUrl.values()];
  },
};
