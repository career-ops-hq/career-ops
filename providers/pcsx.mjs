// Public PCSX search JSON for pinned official employer careers hosts.
// Both official hosts expose /api/pcsx/search without a token; paginate by
// the actual response size because the server caps each response at 10 rows.

import { fetchJsonWithRetry, sleep } from './_http.mjs';

const SOURCES = new Map([
  ['jobs.careers.microsoft.com', { origin: 'https://apply.careers.microsoft.com', domain: 'microsoft.com' }],
  ['careers.microsoft.com', { origin: 'https://apply.careers.microsoft.com', domain: 'microsoft.com' }],
  ['apply.careers.microsoft.com', { origin: 'https://apply.careers.microsoft.com', domain: 'microsoft.com' }],
  ['careers.qualcomm.com', { origin: 'https://careers.qualcomm.com', domain: 'qualcomm.com' }],
  ['jobs.ericsson.com', { origin: 'https://jobs.ericsson.com', domain: 'ericsson.com' }],
  ['careers.kering.com', { origin: 'https://careers.kering.com', domain: 'kering.com' }],
]);

/** Pin both auto-detected legacy pages and explicit API configuration. */
function resolveApi(entry) {
  try {
    const url = new URL(entry?.api ?? entry?.careers_url);
    const source = SOURCES.get(url.hostname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !source) return null;
    if (entry.api && (url.origin !== source.origin || url.pathname !== '/api/pcsx/search'
        || url.searchParams.size !== 1 || url.searchParams.get('domain') !== source.domain)) return null;
    return `${source.origin}/api/pcsx/search?domain=${source.domain}`;
  } catch {
    return null;
  }
}

/** Reject error envelopes and malformed jobs instead of reporting an empty board. */
export function parsePcsxResponse(json, company, origin) {
  if (json?.status !== 200 || !Array.isArray(json.data?.positions)
      || !Number.isInteger(json.data.count) || json.data.count < 0) {
    throw new Error('pcsx: invalid search response');
  }
  return json.data.positions.map(row => {
    if (typeof row?.name !== 'string' || !row.name.trim() || typeof row.positionUrl !== 'string') {
      throw new Error('pcsx: malformed position');
    }
    const url = new URL(row.positionUrl, origin);
    if (url.origin !== origin || url.username || url.password || !/^\/careers\/job\/\d+$/.test(url.pathname)) {
      throw new Error('pcsx: untrusted position URL');
    }
    const job = { title: row.name.trim(), url: url.href, company,
      location: [...new Set((row.locations || []).filter(loc => typeof loc === 'string'))].join('; ') };
    if (typeof row.postedTs === 'number' && Number.isFinite(row.postedTs)
        && row.postedTs > 0 && row.postedTs * 1000 <= 8.64e15) job.postedAt = row.postedTs * 1000;
    return job;
  });
}

export default {
  id: 'pcsx',
  detect(entry) {
    const url = resolveApi(entry);
    return url ? { url } : null;
  },
  async fetch(entry, ctx) {
    const api = resolveApi(entry);
    if (!api) throw new Error('pcsx: unsupported or untrusted URL');
    const origin = new URL(api).origin;
    const maxPages = Number.isInteger(ctx.maxPages) && ctx.maxPages > 0 ? Math.min(ctx.maxPages, 500) : 500;
    const jobs = [];
    const seen = new Set();
    let start = 0;
    for (let page = 0; page < maxPages; page++) {
      if (page) await sleep(origin === 'https://careers.qualcomm.com' ? 750 : 250, ctx);
      let json;
      try {
        json = await fetchJsonWithRetry(ctx, `${api}&start=${start}&num=10`,
          { redirect: 'error' }, { retries: 4, baseDelayMs: 2_000, maxDelayMs: 20_000 });
      } catch (error) {
        if (!jobs.length) throw error;
        jobs.collectionTruncated = true;
        jobs.collectionTruncationKind = error.status === 401 || error.status === 403 ? 'auth'
          : error.status >= 500 ? 'server' : 'network';
        return jobs;
      }
      const rows = parsePcsxResponse(json, entry.name, origin);
      const fresh = rows.filter(row => !seen.has(row.url));
      for (const row of fresh) { seen.add(row.url); jobs.push(row); }
      start += rows.length;
      if (start >= json.data.count || !fresh.length) {
        if (jobs.length < json.data.count) {
          jobs.collectionTruncated = true;
          jobs.collectionTruncationKind = 'coverage_gap';
        }
        return jobs;
      }
    }
    console.error(`⚠️  pcsx: ${entry.name} truncated at ${maxPages} pages (${jobs.length} jobs)`);
    jobs.collectionTruncated = true;
    jobs.collectionTruncationKind = 'page_cap';
    return jobs;
  },
};
