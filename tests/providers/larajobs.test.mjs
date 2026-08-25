// tests/providers/larajobs.test.mjs — provider-contract tests for the LaraJobs
// board-wide RSS provider (providers/larajobs.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — larajobs');

try {
  const larajobsModule = await import(pathToFileURL(join(ROOT, 'providers/larajobs.mjs')).href);
  const larajobs = larajobsModule.default;
  const { parseLarajobsFeed } = larajobsModule;

  if (larajobs.id === 'larajobs') pass('larajobs.id is "larajobs"');
  else fail(`larajobs.id is ${JSON.stringify(larajobs.id)}`);

  // detect() — explicit provider selection only (board-wide feed)
  const hit = larajobs.detect({ name: 'LaraJobs', provider: 'larajobs' });
  if (hit && hit.url === 'https://larajobs.com/feed') pass('larajobs.detect() resolves provider:larajobs → feed URL');
  else fail(`larajobs.detect() returned ${JSON.stringify(hit)}`);
  if (larajobs.detect({ name: 'X' }) === null) pass('larajobs.detect() returns null without provider:larajobs');
  else fail('larajobs.detect() should require provider:larajobs');

  // parseLarajobsFeed — company/location from the job: namespace, entity decode
  const sampleXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:job="https://larajobs.com/ns/job" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>',
    '<title>LaraJobs</title>',
    '<item>',
    '  <title>Laravel &amp; Vue Developer</title>',
    '  <link>https://larajobs.com/job/3899</link>',
    '  <pubDate>Thu, 02 Jul 2026 13:09:40 +0000</pubDate>',
    '  <dc:creator><![CDATA[Fallback Co]]></dc:creator>',
    '  <job:company><![CDATA[Acme PHP]]></job:company>',
    '  <job:location><![CDATA[Lakeland, FL]]></job:location>',
    '</item>',
    '<item>',
    '  <title>Remote Backend Engineer</title>',
    '  <link>https://larajobs.com/job/3900</link>',
    '  <dc:creator><![CDATA[Only Creator Co]]></dc:creator>',
    '</item>',
    '<item>',
    '  <title>Ghost (no link)</title>',
    '</item>',
    '</channel></rss>',
  ].join('\n');

  const jobs = parseLarajobsFeed(sampleXml, 'LaraJobs');
  if (jobs.length === 2) pass('parseLarajobsFeed keeps 2 valid items (drops the link-less one)');
  else fail(`parseLarajobsFeed returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Laravel & Vue Developer' && jobs[0]?.url === 'https://larajobs.com/job/3899') {
    pass('parseLarajobsFeed decodes the title and keeps the job URL');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }
  if (jobs[0]?.company === 'Acme PHP' && jobs[0]?.location === 'Lakeland, FL') {
    pass('parseLarajobsFeed reads company/location from the job: namespace');
  } else {
    fail(`row 0 company/location = ${JSON.stringify([jobs[0]?.company, jobs[0]?.location])}`);
  }
  if (jobs[0]?.postedAt === Date.parse('Thu, 02 Jul 2026 13:09:40 +0000')) {
    pass('parseLarajobsFeed parses pubDate → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }
  if (jobs[1]?.company === 'Only Creator Co' && jobs[1]?.location === '' && jobs[1]?.postedAt === undefined) {
    pass('parseLarajobsFeed falls back to dc:creator and tolerates a missing location/date');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  // Robustness
  if (parseLarajobsFeed('', 'X').length === 0) pass('empty input → empty result');
  else fail('empty input should yield empty result');
  if (parseLarajobsFeed(null, 'X').length === 0) pass('null input → empty result (no crash)');
  else fail('null input should yield empty result without crashing');

  // Company fallback to the entry name when the feed carries neither job:company nor dc:creator
  const bareJobs = parseLarajobsFeed('<item><title>Bare</title><link>https://larajobs.com/job/1</link></item>', 'FallbackName');
  if (bareJobs[0]?.company === 'FallbackName') pass('parseLarajobsFeed falls back to the entry name for company');
  else fail(`bare company fallback = ${JSON.stringify(bareJobs[0]?.company)}`);

  // fetch() pins the request to larajobs.com and passes redirect:'error'
  const fetchJobs = await larajobs.fetch(
    { name: 'LaraJobs', provider: 'larajobs' },
    {
      transport: 'http',
      fetchText: async (url, options) => {
        if (url !== 'https://larajobs.com/feed') throw new Error(`fetchText called with unexpected URL: ${url}`);
        if (options?.redirect !== 'error') throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        return sampleXml;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (fetchJobs.length === 2) pass('larajobs.fetch() hits the feed with redirect:error and returns parsed jobs');
  else fail(`larajobs.fetch() returned ${fetchJobs.length} jobs, expected 2`);

} catch (e) {
  fail(`larajobs provider tests crashed: ${e.message}`);
}
