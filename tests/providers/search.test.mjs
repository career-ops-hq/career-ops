/** Check source-scoped searches, fair limits, JD evidence, deduplication and partial failures. */
import assert from 'node:assert/strict';
import { collectSearch, jobFromPage, searchOptions, searchRequest, withinSites } from '../../adapters/node/providers/search.mjs';

const entry = { name: 'Board', provider: 'search', search: { method: 'web', sites: ['jobs.example.com/roles'], locations: ['Hong Kong'] }, max_results: 3 };
const options = searchOptions(entry);
assert.equal(searchRequest(options, '智能体 & AI'), 'site:jobs.example.com/roles "智能体 & AI" ("Hong Kong")');
const linkedin = searchOptions({ search: { method: 'linkedin', sites: ['linkedin.com/jobs/view'], locations: ['Shanghai, China'] } });
assert.equal(new URL(searchRequest(linkedin, '智能体 & AI')).searchParams.get('keywords'), '智能体 & AI');
assert.equal(new URL(searchRequest(linkedin, 'AI', 1)).searchParams.get('start'), '25');
for (const url of ['https://jobs.example.com.evil/roles/1', 'https://jobs.example.com/roles-other/1', 'http://jobs.example.com/roles/1', 'https://u:p@jobs.example.com/roles/1']) assert.equal(withinSites(url, options.sites), false);
assert.throws(() => searchOptions({ ...entry, search: { ...entry.search, sites: ['127.0.0.1'] } }), /Invalid/);
assert.throws(() => searchOptions({ ...entry, max_results: 0 }), /max_results/);
const detail = url => ({ url, postings: [{ '@type': 'JobPosting', title: 'AI Engineer', hiringOrganization: { name: 'Actual Employer' },
  description: 'Develop production AI applications. '.repeat(12), datePosted: '2026-09-30',
  jobLocation: { address: { addressLocality: 'Hong Kong', addressCountry: 'HK' } } }] });
const url = n => `https://jobs.example.com/roles/${n}`;
const searched = [], read = [];
const jobs = await collectSearch(entry, { searchKeywords: ['AI', '智能体'] }, {
  search: async query => { searched.push(query); return (query.includes('"AI"') ? [1, 2, 3] : [1, 4, 5]).map(n => ({ url: url(n), description: 'Not a JD' })); },
  read: async address => { read.push(address); return detail(address); },
});
assert.deepEqual(jobs.map(job => job.url), [url(1), url(4), url(2)]);
assert.equal(jobs.length, 3);
assert.equal(jobs.collectionTruncated, true);
assert.equal(jobs.collectionTruncationKind, 'result_cap');
assert.equal(jobs[0].company, 'Actual Employer');
assert.equal(jobs[0].location, 'Hong Kong, HK');
assert.equal(jobs[0].scan_jd.text, jobs[0].description);
assert.equal(searched.length, 2);
assert.equal(read.length, 3);
assert.throws(() => jobFromPage({ postings: [] }, url(1)), /JobPosting/);
assert.throws(() => jobFromPage({ postings: [detail(url(1)).postings[0], detail(url(2)).postings[0]] }, url(1)), /JobPosting/);
assert.throws(() => jobFromPage({ postings: [{ ...detail(url(1)).postings[0], description: 'Search snippet' }] }, url(1)), /substantive/);
const chamber = jobFromPage({ text: `\nSystems Engineer II\nGo back »\nCompany:\nEmployer\nLocation:\nShanghai\nJob description\n${'Build and operate services. '.repeat(12)}\nSkills & experience\nEngineering experience.\nContact\nEmail` },
  'https://www.europeanchamber.com.cn/en/job-vacancies/5336/Systems_Engineer_II');
assert.equal(chamber.title, 'Systems Engineer II');
assert.equal(chamber.company, 'Employer');
assert.equal(chamber.location, 'Shanghai');
assert(chamber.description.includes('Engineering experience.'));
assert.throws(() => jobFromPage({ ...detail(url(1)), text: 'This job has been expired' }, url(1)), /expired/);
const partial = await collectSearch(entry, { searchKeywords: ['AI', '智能体'] }, {
  search: async query => { if (query.includes('"AI"')) throw new Error('Search unavailable'); return [{ url: url(1) }, { url: url(2) }]; },
  read: async address => address === url(1) ? { url: 'https://evil.example/job', postings: [] } : detail(address),
});
assert.equal(partial.length, 1);
assert.equal(partial.collectionTruncated, true);
assert.equal(partial.collectionTruncationKind, 'incomplete_details');
let blockedReads = 0;
const blocked = await collectSearch(entry, { searchKeywords: ['AI', '智能体'] }, {
  search: async () => [1, 2, 3].map(n => ({ url: url(n) })),
  read: async () => { blockedReads++; throw new Error('HTTP 429'); },
});
assert.equal(blockedReads, 1);
assert.equal(blocked.collectionTruncated, true);
const aliases = ['https://cn.linkedin.com/jobs/view/engineer-at-acme-123?refId=one', 'https://www.linkedin.com/jobs/view/123?refId=two'];
const deduped = await collectSearch({ ...entry, search: linkedin }, { searchKeywords: ['AI', '智能体'], maxPages: 1 }, {
  search: async () => aliases.map(url => ({ url })), read: async address => detail(address),
});
assert.equal(deduped.length, 1);
console.log('Scoped search collection passed');
