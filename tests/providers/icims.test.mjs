// tests/providers/icims.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — icims');

const mod = await import(pathToFileURL(join(ROOT, 'providers/icims.mjs')).href);
const icims = mod.default;
const { parseIcimsSearchPage } = mod;

const ORIGIN = 'https://careers-acmefreight.icims.com';
const fixture = readFileSync(join(ROOT, 'tests/fixtures/icims-search-page.html'), 'utf-8');

if (icims.id === 'icims') pass('icims.id is "icims"');
else fail(`icims.id is ${JSON.stringify(icims.id)}`);

// detect(): any *.icims.com https careers_url resolves to the search URL.
{
  const hit = icims.detect({ name: 'Acme', careers_url: `${ORIGIN}/jobs/search?ss=1&in_iframe=1` });
  if (hit && hit.url === `${ORIGIN}/jobs/search?ss=1&pr=0&in_iframe=1`) pass('icims.detect() resolves portal search URL');
  else fail(`icims.detect() returned ${JSON.stringify(hit)}`);

  if (icims.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) pass('icims.detect() null for non-icims URL');
  else fail('icims.detect() accepted a non-icims URL');

  if (icims.detect({ name: 'X', careers_url: 'http://careers-a.icims.com/jobs' }) === null) pass('icims.detect() rejects plain http');
  else fail('icims.detect() accepted http URL');
}

// parseIcimsSearchPage(): two same-origin cards parsed; foreign-host card dropped.
{
  const jobs = parseIcimsSearchPage(fixture, ORIGIN, 'acmefreight');
  if (jobs.length === 2) pass('parses 2 same-origin job cards (foreign-host card dropped)');
  else fail(`expected 2 jobs, got ${jobs.length}: ${JSON.stringify(jobs.map(j => j.url))}`);

  const [dir, fork] = jobs;
  if (dir.title === 'Director, Revenue Operations & Strategy') pass('title extracted with entities decoded');
  else fail(`title: ${JSON.stringify(dir.title)}`);
  if (dir.url === `${ORIGIN}/jobs/1234/director%2c-revenue-operations/job`) pass('url extracted with query stripped');
  else fail(`url: ${dir.url}`);
  if (dir.location === 'US-NJ-Edison') pass('location extracted');
  else fail(`location: ${JSON.stringify(dir.location)}`);
  if (dir.company === 'acmefreight') pass('company passed through');
  else fail(`company: ${dir.company}`);
  if (dir.postedAt === undefined) pass('no postedAt on list-page jobs (enrichDate supplies it later)');
  else fail(`unexpected postedAt: ${dir.postedAt}`);
  if (fork.location === 'US-CA-Fontana' && fork.title === 'Forklift Operator') pass('second card parsed');
  else fail(`second card: ${JSON.stringify(fork)}`);
}

// Relative posting hrefs must resolve against the origin, not be dropped.
{
  const relCard = `<li class="iCIMS_JobCardItem"><div class="col-xs-12 title">
    <a href="/jobs/7777/relative-role/job?in_iframe=1" class="iCIMS_Anchor"><h3 >Relative Role</h3></a></div></li>`;
  const jobs = parseIcimsSearchPage(`<ul>${relCard}</ul>`, ORIGIN, 'acmefreight');
  if (jobs.length === 1 && jobs[0].url === `${ORIGIN}/jobs/7777/relative-role/job`) pass('relative href resolved against origin');
  else fail(`relative href: ${JSON.stringify(jobs.map(j => j.url))}`);

  // A relative href is still origin-checked once resolved — a protocol-relative
  // link to another host must not sneak past.
  const offHost = `<li class="iCIMS_JobCardItem"><div class="col-xs-12 title">
    <a href="//evil.example.com/jobs/8888/x/job" class="iCIMS_Anchor"><h3 >Off Host</h3></a></div></li>`;
  if (parseIcimsSearchPage(`<ul>${offHost}</ul>`, ORIGIN, 'acmefreight').length === 0) pass('resolved off-host href still dropped');
  else fail('off-host protocol-relative href was not dropped');
}

// Empty/garbage input → [] not a throw.
{
  if (parseIcimsSearchPage('', ORIGIN, 'x').length === 0 && parseIcimsSearchPage('<html>no cards</html>', ORIGIN, 'x').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// ── fetch(): pagination ─────────────────────────────────────────────
const mkCard = (id, title) => `
<li class="iCIMS_JobCardItem"><div class="row">
<div class="col-xs-6 header left"><span class="sr-only field-label">Location</span><span >US-TX-Austin</span></div>
<div class="col-xs-12 title"><a href="${ORIGIN}/jobs/${id}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/job?in_iframe=1" class="iCIMS_Anchor"><h3 >${title}</h3></a></div>
</div></li>`;
const page = (...cards) => `<ul class="iCIMS_JobsTable">${cards.join('')}</ul>`;

const mkCtx = (pages) => ({
  transport: 'http',
  sleep: async () => {},
  fetchJson: async () => { throw new Error('fetchJson should not be called'); },
  fetchText: async (url) => {
    const pr = Number(new URL(url).searchParams.get('pr'));
    mkCtx.calls.push(pr);
    return pages[pr] ?? page(); // out-of-range → empty page
  },
});

// Multi-page tenant: stops on the first empty page.
{
  mkCtx.calls = [];
  const ctx = mkCtx([page(mkCard(1, 'Role A'), mkCard(2, 'Role B')), page(mkCard(3, 'Role C'))]);
  const jobs = await icims.fetch({ name: 'acmefreight', careers_url: `${ORIGIN}/jobs/search?ss=1` }, ctx);
  if (jobs.length === 3 && mkCtx.calls.join(',') === '0,1,2') pass('fetch paginates and stops on empty page');
  else fail(`jobs=${jobs.length} calls=${mkCtx.calls.join(',')}`);
}

// Tenant that repeats the last page for out-of-range pr: repeat-content stop.
{
  mkCtx.calls = [];
  const repeating = page(mkCard(9, 'Sticky Role'));
  const ctx = mkCtx({ 0: page(mkCard(1, 'First')), 1: repeating, 2: repeating, 3: repeating });
  const jobs = await icims.fetch({ name: 'acmefreight', careers_url: `${ORIGIN}/jobs/search?ss=1` }, ctx);
  if (jobs.length === 2 && mkCtx.calls.length === 3) pass('fetch stops when a page repeats the previous first URL');
  else fail(`jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// ── enrichDate(): detail-page JSON-LD ───────────────────────────────
{
  const job = { title: 'X', url: `${ORIGIN}/jobs/1234/x/job`, company: 'acmefreight', location: 'US' };
  const detail = `<html><script type="application/ld+json">{"@type":"JobPosting","datePosted":"2026-07-20","title":"X"}</script></html>`;
  await icims.enrichDate(job, { fetchText: async () => detail });
  if (job.postedAt === Date.parse('2026-07-20')) pass('enrichDate sets postedAt from JSON-LD datePosted');
  else fail(`postedAt: ${job.postedAt}`);
}
{
  const job = { title: 'X', url: `${ORIGIN}/jobs/1234/x/job`, company: 'acmefreight', location: 'US' };
  await icims.enrichDate(job, { fetchText: async () => '<html>no ldjson</html>' });
  if (job.postedAt === undefined) pass('enrichDate leaves job undated when JSON-LD missing');
  else fail(`postedAt unexpectedly set: ${job.postedAt}`);
}
// @graph document: JobPosting node nested under @graph is still found.
{
  const job = { title: 'X', url: `${ORIGIN}/jobs/1234/x/job`, company: 'acmefreight', location: 'US' };
  const detail = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"JobPosting","datePosted":"2026-07-18"}]}</script>`;
  await icims.enrichDate(job, { fetchText: async () => detail });
  if (job.postedAt === Date.parse('2026-07-18')) pass('enrichDate reads datePosted from an @graph JobPosting node');
  else fail(`@graph postedAt: ${job.postedAt}`);
}
// Array-form JSON-LD: pick the JobPosting element, skip the non-JobPosting one.
{
  const job = { title: 'X', url: `${ORIGIN}/jobs/1234/x/job`, company: 'acmefreight', location: 'US' };
  const detail = `<script type="application/ld+json">[{"@type":"Organization","datePosted":"2026-01-01"},{"@type":"JobPosting","datePosted":"2026-07-19"}]</script>`;
  await icims.enrichDate(job, { fetchText: async () => detail });
  if (job.postedAt === Date.parse('2026-07-19')) pass('enrichDate picks the JobPosting node from an array');
  else fail(`array postedAt: ${job.postedAt}`);
}
{
  const job = { title: 'X', url: `${ORIGIN}/jobs/1234/x/job`, company: 'acmefreight', location: 'US' };
  await icims.enrichDate(job, { fetchText: async () => '<script type="application/ld+json">{broken json</script>' });
  if (job.postedAt === undefined) pass('enrichDate tolerates malformed JSON-LD without throwing');
  else fail(`postedAt unexpectedly set: ${job.postedAt}`);
}
