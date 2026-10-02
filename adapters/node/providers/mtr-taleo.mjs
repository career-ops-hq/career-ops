/** Collect MTR's public Taleo job list with its form-backed pagination. */

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'careers.mtr.com.hk';
const PATH = '/careersection/mtr_external/joblist.ftl';
const ROW_FIELDS = 43;
const MAX_PAGES = 50;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fields(html) {
  const values = new URLSearchParams();
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w.]+)="([^"]*)"/g)]
      .map((match) => [match[1], decodeEntities(match[2])]));
    if (attributes.type === 'hidden' && attributes.name) values.set(attributes.name, attributes.value ?? '');
  }
  return values;
}

function postedAt(value) {
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{2})$/.exec(value);
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[2]);
  return month < 0 ? undefined : Date.UTC(2000 + Number(match[3]), month, Number(match[1]));
}

export function parseList(html) {
  const total = Number(html.match(/Job Openings \((\d+) jobs found\)/)?.[1]);
  const array = html.match(/api\.fillList\('requisitionListInterface',\s*'listRequisition',\s*(\[[\s\S]*?\])\);/)?.[1];
  if (!Number.isInteger(total) || !array) throw new Error('mtr-taleo: missing job list');
  const fields = [...array.matchAll(/'((?:\\.|[^'\\])*)'/g)]
    .map((match) => decodeEntities(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')));
  if (fields.length % ROW_FIELDS) throw new Error('mtr-taleo: unexpected job row format');
  const jobs = [];
  for (let offset = 0; offset < fields.length; offset += ROW_FIELDS) {
    const row = fields.slice(offset, offset + ROW_FIELDS);
    if (!/^\d+$/.test(row[3]) || !row[4] || !row[12]) continue;
    const job = {
      title: row[4],
      url: `https://${HOST}/careersection/mtr_external/jobdetail.ftl?job=${row[3]}&lang=en`,
      location: row[13],
    };
    const date = postedAt(row[20]);
    if (date !== undefined) job.postedAt = date;
    jobs.push(job);
  }
  return { total, jobs };
}

export default {
  id: 'mtr-taleo',
  detect(entry) {
    try {
      const url = new URL(entry.careers_url);
      return url.protocol === 'https:' && url.hostname === HOST && url.pathname === PATH ? { url: url.href } : null;
    } catch {
      return null;
    }
  },
  async fetch(entry, ctx) {
    if (!this.detect(entry)) throw new Error('mtr-taleo: invalid careers URL');
    const limit = Number.isInteger(entry.max_pages) && entry.max_pages > 0
      ? Math.min(entry.max_pages, MAX_PAGES) : MAX_PAGES;
    const url = `https://${HOST}${PATH}?lang=en`;
    let html = await ctx.fetchText(url, { redirect: 'error' });
    const jobs = [];
    const seen = new Set();
    let total = null;
    let listedRows = 0;
    for (let page = 1; page <= limit; page++) {
      const result = parseList(html);
      total ??= result.total;
      if (Number(fields(html).get('rlPager.currentPage')) !== page) break;
      if (page <= Math.ceil(total / 25) && !result.jobs.length) throw new Error(`mtr-taleo: empty page ${page}`);
      listedRows += result.jobs.length;
      let fresh = 0;
      for (const job of result.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push({ ...job, company: entry.name });
        fresh++;
      }
      if (listedRows >= total || page === limit || fresh === 0) break;
      const form = fields(html);
      form.set('rlPager.currentPage', String(page + 1));
      html = await ctx.fetchText(`https://${HOST}${PATH}`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
      });
    }
    jobs.collectionTruncated = listedRows < total;
    if (jobs.collectionTruncated) jobs.collectionTruncationKind = 'coverage_gap';
    return jobs;
  },
};
