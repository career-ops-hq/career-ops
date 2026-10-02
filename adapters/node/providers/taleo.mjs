// Oracle Taleo Enterprise faceted search: public jobboard JSON, no session tokens.
// The landing page supplies the numeric portal ID and single-line column labels.
// Classic/non-faceted pages and unavailable tenants fail explicitly. HSBC's
// current Avature SearchJobs page is not a Taleo career section.

import { isIP } from 'node:net';
import { decodeEntities } from './_html-entities.mjs';
import { sleep } from './_http.mjs';

/** Resolve only Taleo tenants, or an explicitly pinned same-origin branded section. */
export function resolveSite(entry) {
  try {
    const url = new URL(entry?.api ?? entry?.careers_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const tenant = /^[a-z0-9-]+\.taleo\.net$/i.test(url.hostname);
    const branded = entry.provider === 'taleo' && entry.api
      && new URL(entry.careers_url).origin === url.origin
      && url.hostname.includes('.') && !isIP(url.hostname.replace(/^\[|\]$/g, ''));
    if (!tenant && !branded) return null;
    const section = url.pathname.match(/^\/careersection\/([a-z0-9_-]+)\/jobsearch\.ftl$/i)?.[1];
    if (!section) return null;
    url.search = '?lang=en';
    url.hash = '';
    return { origin: url.origin, section, url: url.href };
  } catch {
    return null;
  }
}

/** Read public configuration, never execute scripts or consume CSRF/session values. */
export function parseSearchPage(html) {
  const portal = html.match(/\bportalNo\s*:\s*['"](\d+)['"]/)?.[1];
  if (!portal) throw new Error('taleo: unsupported search page (missing faceted portal ID)');
  const table = html.match(/<table\b[^>]*\bid=['"]jobs['"][^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
  const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(([, text]) => decodeEntities(text.replace(/<[^>]*>/g, '')).trim());
  const postedColumn = headers[0] === 'Icons' ? headers.indexOf('Posting Date') - 1 : -1;
  return { portal, postedColumn };
}

/** Normalize the actual column/linkedColumn/locationsColumns JSON contract. */
export function parseTaleoResponse(json, site, company, postedColumn = -1) {
  if (json?.careerSectionUnAvailable || !Array.isArray(json?.requisitionList)) {
    throw new Error('taleo: unavailable or invalid jobboard response');
  }
  return json.requisitionList.map(row => {
    const title = row?.column?.[row.linkedColumn];
    if (typeof title !== 'string' || !title.trim() || typeof row.contestNo !== 'string' || !row.contestNo.trim()) {
      throw new Error('taleo: malformed requisition');
    }
    const locations = (row.locationsColumns || []).flatMap(index => {
      const values = JSON.parse(row.column[index]);
      if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
        throw new Error('taleo: malformed locations');
      }
      return values;
    });
    const url = new URL(`/careersection/${site.section}/jobdetail.ftl`, site.origin);
    url.search = new URLSearchParams({ job: row.contestNo, lang: 'en' }).toString();
    const job = { title: decodeEntities(title.trim()), url: url.href, company,
      location: [...new Set(locations.map(decodeEntities))].join('; ') };
    const rawDate = row.column[postedColumn];
    const date = typeof rawDate === 'string' && rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (date) {
      const iso = `${date[3]}-${date[1]}-${date[2]}T00:00:00.000Z`;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms) && new Date(ms).toISOString() === iso) job.postedAt = ms;
    }
    return job;
  });
}

export default {
  id: 'taleo',
  detect(entry) {
    const site = resolveSite(entry);
    return site ? { url: site.url } : null;
  },
  async fetch(entry, ctx) {
    const site = resolveSite(entry);
    if (!site) throw new Error('taleo: unsupported or untrusted career section');
    const { portal, postedColumn } = parseSearchPage(await ctx.fetchText(site.url, { redirect: 'error' }));
    const api = new URL('/careersection/rest/jobboard/searchjobs', site.origin);
    api.search = new URLSearchParams({ lang: 'en', portal }).toString();
    const maxPages = Number.isInteger(ctx.maxPages) && ctx.maxPages > 0 ? Math.min(ctx.maxPages, 200) : 200;
    const jobs = [];
    const seen = new Set();
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      if (pageNo > 1) await sleep(250, ctx);
      const json = await ctx.fetchJson(api.href, {
        redirect: 'error', method: 'POST',
        headers: { 'content-type': 'application/json', tz: 'GMT+00:00', tzname: 'UTC' },
        body: JSON.stringify({ pageNo, multilineEnabled: false,
          sortingSelection: { sortBySelectionParam: '3', ascendingSortingOrder: 'false' },
          fieldData: { fields: {}, valid: true },
          filterSelectionParam: { searchFilterSelections: [] } }),
      });
      const rows = parseTaleoResponse(json, site, entry.name, postedColumn);
      const paging = json.pagingData;
      if (!Number.isInteger(paging?.totalCount) || paging.totalCount < 0
          || !Number.isInteger(paging.pageSize) || paging.pageSize <= 0 || paging.currentPageNo !== pageNo) {
        throw new Error('taleo: invalid pagination');
      }
      const fresh = rows.filter(row => !seen.has(row.url));
      for (const row of fresh) { seen.add(row.url); jobs.push(row); }
      if (pageNo * paging.pageSize >= paging.totalCount) return jobs;
      if (!fresh.length) throw new Error('taleo: pagination stopped before totalCount');
    }
    console.error(`⚠️  taleo: ${entry.name} truncated at ${maxPages} pages (${jobs.length} jobs)`);
    return jobs;
  },
};
