// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Habr Career provider — https://career.habr.com, the main Russian-language IT
// job board. Board-wide aggregator, so it targets the `job_boards:` list and is
// reached only by an explicit `provider: habrcareer` (no URL-pattern detect():
// a career.habr.com URL in a `tracked_companies:` entry is usually one
// company's page, and claiming it would hand that entry the whole board).
//
// Optional per-entry tuning:
//   remote: true  — only postings marked "готов к удалённой работе"
//       (the board's own `remote=true` filter). Omit for the whole board.
//   max_pages: N  — 25 postings per page; see DEFAULT_MAX_PAGES.
//
// HOW IT READS THE BOARD. Measured on 2026-10-02: /vacancies is server-
// rendered with the full page of postings in a
// `<script type="application/json" data-ssr-state="true">` block
// (`vacancies.list`, 25 per page, `vacancies.meta.totalPages` alongside).
// No auth, no JS, the default scanner User-Agent is served. Whole board was
// 1,111 postings / 38 pages; remote-only 380 / 16. A page past the end
// answers 200 with an empty list. Pages are walked with `sort=date`, so the
// newest postings come first and promoted (`isMarked`) cards don't reorder
// the walk — every page is read either way (Source Indexing Policy rule 3).
//
// robots.txt (fetched 2026-10-02) disallows `/v1`, `/suggest`, user and
// response paths for `User-agent: *` — `/vacancies` with a query string is
// allowed. This provider requests only `/vacancies?...`; it never touches the
// `/api/frontend` JSON endpoint.
//
// The list payload carries no upstream employer/ATS link, so `job.url` is the
// board's own posting page (Source Indexing Policy rule 2 fallback).

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const ORIGIN = 'https://career.habr.com';

/** Postings per listing page, as served. */
const PAGE_SIZE = 25;

/** 38 pages covered the whole board on 2026-10-02; 60 leaves headroom. */
const DEFAULT_MAX_PAGES = 60;

/** Hard ceiling even for an explicit `max_pages` override. */
const MAX_PAGES_CAP = 100;

/** Pacing between pages. No throttling was observed; this is the norm. */
const INTER_PAGE_DELAY_MS = 300;

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Build a listing URL. Only `type`, `sort`, `remote` and `page` are ever sent.
 * @param {{ remote?: boolean }} opts
 * @param {number} page - 1-based.
 */
export function buildListUrl(opts, page) {
  const params = ['type=all', 'sort=date'];
  if (opts.remote) params.push('remote=true');
  if (page > 1) params.push(`page=${page}`);
  return `${ORIGIN}/vacancies?${params.join('&')}`;
}

/** @param {unknown} html */
export function extractSsrState(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/<script[^>]*data-ssr-state=["']true["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/** @param {unknown} s */
const text = (s) => (typeof s === 'string' ? decodeEntities(s).replace(/\s+/g, ' ').trim() : '');

/**
 * Map one row of `vacancies.list` to a Job, or null for an archived, hidden
 * or malformed row.
 * @param {any} row
 */
export function normalizeRow(row) {
  if (!row || typeof row !== 'object' || row.archived || row.hidden) return null;
  const title = text(row.title);
  const id = row.id;
  if (!title || !(Number.isInteger(id) && id > 0)) return null;

  const cities = Array.isArray(row.locations)
    ? row.locations.map((l) => text(l?.title)).filter(Boolean)
    : [];
  if (!cities.length && row.location) {
    const single = text(typeof row.location === 'string' ? row.location : row.location?.title);
    if (single) cities.push(single);
  }
  const place = cities.join(', ');
  const location = row.remoteWork ? (place ? `${place} (Remote)` : 'Remote') : place;

  /** @type {{title: string, url: string, company: string, location: string, postedAt?: number, id: string}} */
  const job = {
    id: String(id),
    title,
    url: `${ORIGIN}/vacancies/${id}`,
    company: text(row.company?.title),
    location,
  };
  const postedAt = Date.parse(row.publishedDate?.date ?? '');
  if (!Number.isNaN(postedAt)) job.postedAt = postedAt;
  return job;
}

/**
 * Parse one listing page. Throws when the page is not the documented shape —
 * a markup change must look like a broken board, not an empty one.
 * @param {string} html
 * @param {string} url
 */
export function parseListingPage(html, url) {
  const state = extractSsrState(html);
  if (!state) throw new Error(`habrcareer: ${url} has no parseable data-ssr-state JSON — the page markup changed`);
  const list = state?.vacancies?.list;
  if (!Array.isArray(list)) {
    const got = state && typeof state === 'object' ? Object.keys(state).join(', ') : typeof state;
    throw new Error(`habrcareer: unexpected SSR state at ${url} — expected vacancies.list[], got: [${got}]`);
  }
  const totalPages = state.vacancies?.meta?.totalPages;
  return {
    jobs: list.map(normalizeRow).filter(Boolean),
    rawCount: list.length,
    totalPages: Number.isInteger(totalPages) ? totalPages : null,
  };
}

/** @type {Provider} */
export default {
  id: 'habrcareer',

  detect(entry) {
    return entry?.provider === 'habrcareer' ? { url: buildListUrl({ remote: entry.remote === true }, 1) } : null;
  },

  async fetch(entry, ctx) {
    const opts = { remote: entry?.remote === true };
    const maxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const probing = ctxCap !== Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();
    let totalPages = null;
    let page = 1;
    for (; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = buildListUrl(opts, page);
      let html;
      try {
        html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
      } catch (err) {
        // Probe failures and a first-page failure are the board failing; a
        // later page failing keeps what was read and warns.
        if (probing || page === 1) throw err;
        console.error(`⚠️  habrcareer: ${entry.name} stopped at page ${page}: ${/** @type {Error} */ (err).message} — keeping ${jobs.length} postings read so far`);
        return jobs;
      }
      const parsed = parseListingPage(html, url);
      if (totalPages === null) totalPages = parsed.totalPages;
      for (const job of parsed.jobs) {
        if (!job || seen.has(job.id)) continue;
        seen.add(job.id);
        const { id: _id, ...rest } = job;
        jobs.push(rest);
      }
      if (parsed.rawCount < PAGE_SIZE) return jobs;
      if (totalPages !== null && page >= totalPages) return jobs;
    }

    if (!probing) {
      const of = totalPages !== null ? ` of ${totalPages}` : '';
      console.error(`⚠️  habrcareer: ${entry.name} truncated at max_pages=${maxPages}${of} pages — raise max_pages on this entry for more`);
    }
    return jobs;
  },
};
