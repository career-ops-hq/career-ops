// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages } from './_paging.mjs';

// Oracle Recruiting Cloud (Fusion HCM "recruitingCE") provider. Powers many
// large enterprise boards (American Express, ...). The public REST API lives on
// the Oracle Fusion pod host (e.g. egug.fa.us2.oraclecloud.com), NOT the vanity
// careers domain. Configure via an `oracle:` block on the portals.yml entry:
//
//   - name: American Express
//     careers_url: "https://careers.americanexpress.com/en/sites/CX_1/jobs"
//     provider: oracle
//     oracle:
//       host: egug.fa.us2.oraclecloud.com   # Oracle Fusion pod (REQUIRED)
//       site: CX_1                           # siteNumber (REQUIRED)
//       job_base: "https://careers.americanexpress.com/en/sites/CX_1/job"  # public job URL prefix
//       queries: ["strategy", "business operations", ...]  # optional server-side keyword searches
//
// IMPORTANT: Oracle's `finder` is param-ORDER sensitive — limit/offset MUST come
// before sortBy, and the `expand` query param must be present, or requisitionList
// comes back empty. The page size is capped at 25.

const PAGE_SIZE = 25;       // Oracle CE caps the requisitionList page at 25
const PAGE_CAP = 40;        // safety: 40 * 25 = 1000 results per query
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonRetry(ctx, url, opts) {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    try { return await ctx.fetchJson(url, opts); }
    catch (err) {
      if (!err || !RETRY_STATUSES.has(err.status) || attempt >= MAX_RETRIES) throw err;
      await sleep(delay); delay *= 2;
    }
  }
}

function getConfig(entry) {
  const c = entry.oracle || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : [c.query || ''];
  return { host: c.host, site: c.site, jobBase: c.job_base || '', queries };
}

function jobUrl(jobBase, host, site, id) {
  if (jobBase) return `${jobBase.replace(/\/$/, '')}/${id}`;
  return `https://${host}/en/sites/${site}/job/${id}`;
}

function locationOf(r) {
  const sec = Array.isArray(r.secondaryLocations)
    ? r.secondaryLocations.map(s => s.Name || s.GeographyName || '').filter(Boolean)
    : [];
  return [...new Set([r.PrimaryLocation, ...sec].filter(Boolean))].join('; ');
}

async function fetchQuery(host, site, query, ctx) {
  const out = [];
  for (let page = 0; page < pageCap; page++) {
    const offset = page * PAGE_SIZE;
    // Param order matters: limit/offset BEFORE sortBy.
    const finder = `findReqs;siteNumber=${site}`
      + (query ? `,keyword=${encodeURIComponent(query)}` : '')
      + `,limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
    const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
      + `?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=${finder}`;
    // redirect:'error' matches every other provider here: following a redirect
    // lets a compromised or misconfigured Fusion pod bounce the scanner to an
    // internal address, and the response body would be parsed as job data.
    const json = await fetchJsonRetry(ctx, url, { headers: { accept: 'application/json' }, redirect: 'error' });
    const item = (json && Array.isArray(json.items) && json.items[0]) || {};
    const reqs = Array.isArray(item.requisitionList) ? item.requisitionList : [];
    out.push(...reqs);
    const total = typeof item.TotalJobsCount === 'number' ? item.TotalJobsCount : null;
    if (reqs.length === 0) break;
    if (total != null && out.length >= total) break;
    if (page === pageCap - 1) {
      console.error(`⚠️  oracle: hit ${pageCap}-page cap for query "${query || '(all)'}" on ${host}`);
    }
  }
  return out;
}

/** @type {Provider} */

export default {
  id: 'oracle',

  detect(entry) {
    if (entry.oracle) return { url: `https://${getConfig(entry).host || ''}` };
    return null;
  },

  async fetch(entry, ctx) {
    const pageCap = resolveMaxPages(entry, ctx, PAGE_CAP);
    const { host, site, jobBase, queries } = getConfig(entry);
    if (!host) throw new Error(`oracle: "${entry.name}" needs oracle.host (Fusion pod) in portals.yml`);
    if (!site) throw new Error(`oracle: "${entry.name}" needs oracle.site (siteNumber) in portals.yml`);
    const byId = new Map();
    for (const query of queries) {
      for (const r of await fetchQuery(host, site, query, ctx)) {
        const id = r.Id ?? r.id;
        if (id != null && !byId.has(id)) byId.set(id, r);
      }
    }
    return [...byId.values()].map(r => ({
      title: (r.Title || '').trim(),
      url: jobUrl(jobBase, host, site, r.Id ?? r.id),
      company: entry.name,
      location: locationOf(r),
    })).filter(j => j.title && j.url);
  },
};
