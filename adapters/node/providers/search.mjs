/** Discover source-scoped URLs and read structured job details before returning postings. */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { newExtractionPage, readPage } from '../browser/browser-extract.mjs';
import { rejectPrivateOrInvalid, validateUrlSecurity } from '../browser/liveness-browser.mjs';
import { normalizeUrl } from '../shared/url-key.mjs';
import { providerKeywords } from './_profile-keywords.mjs';

export function searchOptions(entry) {
  const search = entry.search;
  if (!search || !['web', 'linkedin'].includes(search.method)) throw new Error('search.method must be web or linkedin');
  if (!Array.isArray(search.sites) || !search.sites.length) throw new Error('search.sites must contain source domains or domain/path scopes');
  for (const site of search.sites) {
    if (typeof site !== 'string' || !/^[a-z0-9.-]+(?:\/[a-z0-9_./-]*)?$/i.test(site)
        || rejectPrivateOrInvalid(`https://${site}`)) throw new Error(`Invalid search site: ${site}`);
  }
  const locations = search.locations ?? [];
  if (!Array.isArray(locations) || locations.some(location => typeof location !== 'string' || !location.trim())) {
    throw new Error('search.locations must be an array of non-empty strings');
  }
  if (search.method === 'linkedin' && (locations.length !== 1 || search.sites.length !== 1
      || search.sites[0] !== 'linkedin.com/jobs/view')) throw new Error('LinkedIn requires one location and linkedin.com/jobs/view');
  const max = entry.max_results ?? 50;
  if (!Number.isInteger(max) || max < 1 || max > 500) throw new Error('max_results must be an integer from 1 to 500');
  return { ...search, locations, max };
}

export function withinSites(value, sites) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return sites.some(site => {
      const scope = new URL(`https://${site}`);
      return (url.hostname === scope.hostname || url.hostname.endsWith(`.${scope.hostname}`))
        && (scope.pathname === '/' || url.pathname === scope.pathname || url.pathname.startsWith(`${scope.pathname.replace(/\/$/, '')}/`));
    });
  } catch { return false; }
}

export function searchRequest(options, keyword, page = 0) {
  if (options.method === 'linkedin') {
    const url = new URL('https://www.linkedin.com/jobs/search/');
    url.search = new URLSearchParams({ keywords: keyword, location: options.locations[0],
      f_TPR: 'r2592000', f_JT: 'F', sortBy: 'DD', start: String(page * 25) }).toString();
    return url.href;
  }
  const quote = value => `"${value.replace(/["\\]/g, ' ')}"`;
  const scope = options.sites.map(site => `site:${site}`).join(' OR ');
  return `${options.sites.length === 1 ? scope : `(${scope})`} ${quote(keyword)}`
    + (options.locations.length ? ` (${options.locations.map(quote).join(' OR ')})` : '');
}

function postingKey(value) {
  const url = new URL(value);
  const id = /\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname)?.[1];
  return id && (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'))
    ? `https://www.linkedin.com/jobs/view/${id}` : normalizeUrl(value);
}

function webSearch(query) {
  return new Promise((resolve, reject) => {
    const child = execFile(join(homedir(), '.hermes/hermes-agent/venv/bin/python'),
      [fileURLToPath(new URL('../../../career_ops/web_search.py', import.meta.url))],
      { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) { reject(new Error(`Web search failed: ${(stderr || error.message).slice(-1500)}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Web search returned invalid JSON')); }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ query }));
  });
}

/** Read the European Chamber's labelled detail page, which has no JobPosting markup. */
function chamberPosting(raw, url) {
  const parsed = new URL(url);
  if (!['www.europeanchamber.com.cn', 'europeanchamber.com.cn'].includes(parsed.hostname)
      || !/^\/en\/job-vacancies\/\d+\//.test(parsed.pathname)) return [];
  const text = raw.text || '';
  const title = /^\s*(.+?)\s+Go back »/.exec(text)?.[1];
  const company = /^\s*Company:\s*\n+([^\n]+)/m.exec(text)?.[1]?.trim();
  const location = /^\s*Location:\s*\n+([^\n]+)/m.exec(text)?.[1]?.trim();
  const start = text.lastIndexOf('Job description');
  if (!title || !company || start < 0 || !text.slice(start).includes('Skills & experience')) return [];
  const description = text.slice(0, text.indexOf('Job description')).trim() + '\n\n'
    + text.slice(start).split(/\n\s*Contact\s*\n/)[0].trim();
  return [{ title, hiringOrganization: { name: company }, description, jobLocation: { address: location || '' } }];
}

/** Require identified detail-page evidence; a search snippet cannot supply a JD. */
export function jobFromPage(raw, url) {
  if (/this job has (?:been )?expired|no longer accepting applications/i.test(raw.text || '')) throw new Error('Job posting is expired');
  const postings = raw.postings?.length ? raw.postings : chamberPosting(raw, url);
  const matching = postings.filter(posting => !posting.url || postingKey(posting.url) === postingKey(url));
  if (matching.length !== 1 || postings.length !== 1) throw new Error('No unambiguous JobPosting on detail page');
  const posting = matching[0];
  if (Number.isFinite(Date.parse(posting.validThrough)) && Date.parse(posting.validThrough) < Date.now()) {
    throw new Error('Job posting is expired');
  }
  const company = posting.hiringOrganization?.name;
  if (typeof posting.title !== 'string' || !posting.title.trim() || typeof company !== 'string' || !company.trim()
      || typeof posting.description !== 'string' || posting.description.trim().length < 200) {
    throw new Error('JobPosting is missing title, employer, or substantive description');
  }
  const locations = [posting.jobLocation ?? []].flat().map(location => {
    const address = location?.address;
    return typeof address === 'string' ? address : [address?.addressLocality, address?.addressRegion,
      typeof address?.addressCountry === 'string' ? address.addressCountry : address?.addressCountry?.name].filter(Boolean).join(', ');
  }).filter(Boolean);
  const postedAt = Date.parse(posting.datePosted);
  const text = posting.description.trim();
  if (text.length > 100000) throw new Error('JobPosting exceeds the supported JD size');
  return { title: posting.title.trim(), company: company.trim(), url,
    location: locations.join('; '), description: text,
    ...(Number.isFinite(postedAt) ? { postedAt } : {}),
    scan_jd: { text, final_url: url, retrieved_at: new Date().toISOString() } };
}

/** Visit one result per keyword per round, sharing a deduplicated source limit. */
export async function collectSearch(entry, context, { search, read }) {
  const options = searchOptions(entry);
  const keywords = providerKeywords(context);
  const queues = keywords.map(keyword => ({ keyword, page: 0, rows: [], done: false }));
  const seen = new Set(), jobs = [], warnings = [];
  const deadline = (context?.deadlineMs ?? Date.now() + 600_000) - 75_000;
  const queries = [];
  let bounded = false;
  while (queues.some(queue => !queue.done || queue.rows.length) && jobs.length < options.max) {
    if (Date.now() >= deadline) { warnings.push('Search time budget reached'); bounded = true; break; }
    for (const queue of queues) {
      if (jobs.length >= options.max || Date.now() >= deadline) break;
      if (!queue.rows.length && !queue.done) {
        const request = searchRequest(options, queue.keyword, queue.page);
        queries.push(request);
        try {
          const rows = await search(request, options.method);
          if (!Array.isArray(rows)) throw new Error('Search returned invalid rows');
          queue.rows = rows.filter(row => withinSites(row.url, options.sites));
          queue.request = request;
          queue.page++;
          queue.done = options.method === 'web' || !rows.length || queue.page >= (context?.maxPages ?? 10);
          if (options.method === 'web' && rows.length >= 20 || queue.page >= (context?.maxPages ?? 10)) bounded = true;
          if (rows.length && !queue.rows.length) warnings.push(`${queue.keyword}: results did not match source scope`);
          if (queue.rows.length && queue.rows.every(row => seen.has(postingKey(row.url)))) {
            queue.rows = [];
            if (!queue.done) { queue.done = true; bounded = true; warnings.push(`${queue.keyword}: search repeated a page`); }
          }
        } catch (error) { warnings.push(`${queue.keyword}: ${error.message}`); queue.done = true; }
      }
      while (queue.rows.length) {
        const row = queue.rows.shift();
        const key = postingKey(row.url);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const detail = await read(row.url);
          if (!withinSites(detail.url, options.sites) || postingKey(detail.url) !== key) {
            throw new Error('Detail redirected away from the discovered posting');
          }
          jobs.push({ ...jobFromPage(detail, detail.url), discovery_query: queue.request });
        } catch (error) {
          warnings.push(`${row.url}: ${error.message}`);
          if (/HTTP (?:401|403|405|429)\b/.test(error.message)) {
            queues.forEach(queue => { queue.rows = []; queue.done = true; });
          }
        }
        break;
      }
    }
  }
  if (warnings.length) console.error(`${entry.name}: ${warnings.join('; ')}`);
  jobs.collectionTruncated = bounded || warnings.length > 0 || jobs.length >= options.max;
  jobs.collectionTruncationKind = warnings.length ? 'incomplete_details' : 'result_cap';
  jobs.collectionQueries = queries;
  return jobs;
}

export default {
  id: 'search',
  async fetch(entry, context) {
    searchOptions(entry);
    providerKeywords(context);
    const browser = await chromium.launch({ headless: true });
    try {
      const read = async (url, mode = 'jd') => {
        await validateUrlSecurity(url);
        const page = await newExtractionPage(browser);
        try {
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
          const raw = await readPage(page, { mode, timeout: 10000 });
          return { ...raw, url: page.url() };
        } finally { await page.context().close(); }
      };
      return await collectSearch(entry, context, {
        read,
        search: async (request, method) => {
          if (method === 'web') return webSearch(request);
          const raw = await read(request, 'listing');
          if (new URL(raw.url).pathname !== '/jobs/search/') throw new Error('LinkedIn search redirected');
          const rows = raw.anchors.map(anchor => ({ url: new URL(anchor.href, raw.url).href }))
            .filter(row => withinSites(row.url, ['linkedin.com/jobs/view']));
          if (!rows.length && !/no (?:matching )?(?:jobs|results)|0 jobs|未找到/i.test(raw.text)) {
            throw new Error('LinkedIn returned no readable results or explicit empty state');
          }
          return rows;
        },
      });
    } finally { await browser.close(); }
  },
};
