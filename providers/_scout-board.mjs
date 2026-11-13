// @ts-check
// Small parsing/pagination primitives for the explicit job-board adapters.
import { decodeEntities } from './_html-entities.mjs';
import { visibleText } from './_html-to-text.mjs';
import { fetchTextWithRetry, fetchJsonWithRetry, sleep } from './_http.mjs';

export const str = value => typeof value === 'string' ? value.trim() : '';
export const text = value => visibleText(str(value)).replace(/\s+/g, ' ').trim();
export function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  return m ? decodeEntities(m[2]) : '';
}
export function epoch(value) {
  const ms = typeof value === 'string' && value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}
export function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u.href : '';
  } catch { return ''; }
}
export function boardUrl(value, origin, pathPattern) {
  if (!str(value)) return '';
  try {
    const u = new URL(decodeEntities(value), origin);
    if (u.origin !== origin || u.username || u.password || !pathPattern.test(u.pathname)) return '';
    return `${origin}${u.pathname}`;
  } catch { return ''; }
}
export function nextData(html, id) {
  const m = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) throw new Error(`${id}: missing __NEXT_DATA__`);
  try { return JSON.parse(m[1]); }
  catch { throw new Error(`${id}: invalid __NEXT_DATA__ JSON`); }
}
export function assertCards(id, html, jobs, signal) {
  if (signal.test(html) && !jobs.length) throw new Error(`${id}: posting links present but no cards parsed`);
}

// max_pages counts result pages; no source-controlled URL is ever fetched.
// A short/empty source page wins over a local cap, even after malformed rows
// or duplicate listings were removed from the output.
export async function walkPages({ id, entry, ctx, url, parse, pageSize, json = false,
  headers, defaultPages = 40, hardCap = 200, delayMs = 250 }) {
  const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, hardCap) : defaultPages;
  const hint = Number(ctx.maxPages);
  const limit = Math.min(configured, Number.isFinite(hint) && hint > 0 ? Math.max(1, Math.floor(hint)) : Infinity);
  const jobs = new Map();
  for (let page = 1; page <= limit; page++) {
    if (page > 1) await sleep(delayMs, ctx);
    const body = await (json ? fetchJsonWithRetry : fetchTextWithRetry)(ctx, url(page), { redirect: 'error', ...(headers ? { headers } : {}) });
    const parsed = parse(body);
    for (const job of parsed.jobs) jobs.set(job.url, job);
    const more = parsed.more ?? parsed.rawCount >= pageSize;
    if (!parsed.rawCount || !more) break;
    if (page === limit && ctx.maxPages == null) console.warn(`${id}: reached max_pages; inventory may be incomplete — raise max_pages on this entry`);
  }
  return [...jobs.values()];
}
