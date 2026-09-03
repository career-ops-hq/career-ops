// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, fetchTextWithRetry } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

const TALEO_HOST_RE = /^[a-z0-9-]+\.taleo\.net$/i;
const SECTION_RE = /^\/careersection\/([a-z0-9._-]+)\/(?:jobsearch|joblist|jobdetail)\.ftl$/i;
const DEFAULT_MAX_PAGES = 100;
const MAX_PAGES_CAP = 1000;
const PAGE_SIZE = 25;
const RETRY_POLICY = { retries: 2 };

function safeEncode(value) {
  try {
    return encodeURIComponent(String(value));
  } catch {
    return encodeURIComponent(String(value).replace(/[\uD800-\uDFFF]/g, '\uFFFD'));
  }
}

function parseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || !TALEO_HOST_RE.test(url.hostname)) return null;
    const match = url.pathname.match(SECTION_RE);
    if (!match) return null;
    return { url, section: match[1] };
  } catch { return null; }
}

function assertTaleoUrl(raw) {
  const parsed = parseUrl(raw);
  if (!parsed) throw new Error(`taleo: untrusted or invalid TEE URL: ${raw}`);
  return parsed.url;
}

function resolveBoard(entry) {
  for (const raw of [entry.api, entry.careers_url]) {
    const parsed = parseUrl(raw);
    if (parsed) return parsed;
  }
  return null;
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return htmlToText(String(value));
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    for (const key of ['value', 'text', 'label', 'name', 'displayValue']) {
      if (value[key] != null) return textValue(value[key]);
    }
  }
  return '';
}

function extractPortal(html) {
  const matches = [
    /[?&]portal=(\d+)/i,
    /["']portal(?:Id)?["']?\s*[:=]\s*["']?(\d+)/i,
    /name=["']portal["'][^>]*value=["'](\d+)/i,
  ];
  for (const re of matches) {
    const hit = html.match(re);
    if (hit) return hit[1];
  }
  return '';
}

function extractLang(url) {
  return url.searchParams.get('lang') || 'en';
}

function extractHeadings(html) {
  const labels = [];
  for (const m of html.matchAll(/<(?:th|label)[^>]*>([\s\S]*?)<\/(?:th|label)>/gi)) {
    const value = htmlToText(m[1]);
    if (value) labels.push(value);
  }
  return labels;
}

function fieldIndex(headings, patterns) {
  return headings.findIndex((h) => patterns.some((p) => p.test(h)));
}

function parseColumns(row, headings) {
  const columns = Array.isArray(row?.column) ? row.column : [];
  const values = columns.map(textValue);
  const titleIndex = fieldIndex(headings, [/requisition\s*title/i, /job\s*title/i, /^title$/i]);
  const locationIndex = fieldIndex(headings, [/location/i, /city/i]);
  const postedIndex = fieldIndex(headings, [/posting\s*date/i, /date\s*posted/i, /posted/i]);
  const title = titleIndex >= 0 ? values[titleIndex] : textValue(row?.title || row?.jobTitle);
  const location = locationIndex >= 0 ? values[locationIndex] : textValue(row?.location || row?.locationsColumns);
  const posted = postedIndex >= 0 ? values[postedIndex] : '';
  return { title, location, posted };
}

function toEpochMs(value) {
  if (!value) return undefined;
  const n = Date.parse(value);
  return Number.isNaN(n) ? undefined : n;
}

/** @param {any} json @param {{url:URL,section:string}} board @param {string[]} headings @param {string} company */
export function parseTaleoResponse(json, board, headings, company) {
  const rows = json?.requisitionList;
  if (!Array.isArray(rows)) return [];
  const lang = extractLang(board.url);
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = row.jobId ?? row.contestNo;
    if (id == null || String(id).trim() === '') continue;
    const parsed = parseColumns(row, headings);
    if (!parsed.title) continue;
    const detail = new URL(`https://${board.url.hostname}/careersection/${safeEncode(board.section)}/jobdetail.ftl`);
    detail.searchParams.set('job', String(id));
    detail.searchParams.set('lang', lang);
    const job = { title: parsed.title, url: detail.href, company: company || '', location: parsed.location };
    const postedAt = toEpochMs(parsed.posted);
    if (postedAt !== undefined) job.postedAt = postedAt;
    out.push(job);
  }
  return out;
}

function buildSearchUrl(board, portal) {
  const url = new URL(`https://${board.url.hostname}/careersection/rest/jobboard/searchjobs`);
  url.searchParams.set('lang', extractLang(board.url));
  url.searchParams.set('portal', portal);
  return url.href;
}

function buildBody(page) {
  return {
    multilineEnabled: false,
    sortingSelection: { sortBySelectionParam: '5', ascendingSortingOrder: 'true' },
    fieldData: { fields: { KEYWORD: '', LOCATION: '' }, valid: true },
    filterSelectionParam: { searchFilterSelections: [] },
    advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
    pageNo: page,
  };
}

/** @type {Provider} */
export default {
  id: 'taleo',
  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: board.url.href } : null;
  },
  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`taleo: cannot derive a public Taleo career-section URL for ${entry.name}`);
    const shellUrl = assertTaleoUrl(board.url.href);
    const shell = await fetchTextWithRetry(ctx, shellUrl.href, { redirect: 'error' }, RETRY_POLICY);
    const portal = extractPortal(shell);
    if (!portal) throw new Error(`taleo: career section is private, unavailable, or missing a public portal id (${shellUrl.href})`);
    const headings = extractHeadings(shell);
    const maxEntry = Number.isInteger(entry.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES;
    const maxPages = Math.min(maxEntry, MAX_PAGES_CAP, Number.isInteger(ctx.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : MAX_PAGES_CAP);
    const apiUrl = buildSearchUrl(board, portal);
    assertTaleoUrl(shellUrl.href);
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const json = await fetchJsonWithRetry(ctx, apiUrl, {
        method: 'POST',
        redirect: 'error',
        headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', tz: 'America/Toronto', tzname: 'America/Toronto' },
        body: JSON.stringify(buildBody(page)),
      }, RETRY_POLICY);
      const jobs = parseTaleoResponse(json, board, headings, entry.name);
      all.push(...jobs);
      const paging = json?.pagingData || {};
      const total = Number(paging.totalCount);
      const size = Number(paging.pageSize) || PAGE_SIZE;
      if (!jobs.length || (Number.isFinite(total) && page * size >= total) || jobs.length < size) break;
    }
    return all;
  },
};

export { extractPortal, extractHeadings, buildBody, buildSearchUrl, resolveBoard };
