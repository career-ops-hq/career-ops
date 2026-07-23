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

// Empty/garbage input → [] not a throw.
{
  if (parseIcimsSearchPage('', ORIGIN, 'x').length === 0 && parseIcimsSearchPage('<html>no cards</html>', ORIGIN, 'x').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}
