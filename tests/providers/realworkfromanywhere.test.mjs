// tests/providers/realworkfromanywhere.test.mjs — provider-contract tests for
// the Real Work From Anywhere board-wide RSS provider
// (providers/realworkfromanywhere.mjs). Fixtures are invented.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — realworkfromanywhere');

const FEED_URL = 'https://www.realworkfromanywhere.com/rss.xml';

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/realworkfromanywhere.mjs')).href);
  const p = mod.default;
  const { parseRwfaFeed } = mod;

  if (p.id === 'realworkfromanywhere') pass('id is "realworkfromanywhere"');
  else fail(`id=${JSON.stringify(p.id)}`);

  // detect() — explicit provider selection only (board-wide feed)
  const hit = p.detect({ name: 'RWFA', provider: 'realworkfromanywhere' });
  if (hit && hit.url === FEED_URL) pass('detect() resolves provider:realworkfromanywhere → feed URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (p.detect({ name: 'X', careers_url: 'https://www.realworkfromanywhere.com/' }) === null && p.detect(null) === null) {
    pass('detect() returns null without provider:realworkfromanywhere (no throw on null)');
  } else fail('detect() should be explicit-only');

  const sampleXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    '<title>Remote Jobs - Real Work From Anywhere</title>',
    '<item>',
    '  <title><![CDATA[Data & Platform Engineer at Acme Labs]]></title>',
    '  <description><![CDATA[<p>About Acme</p>]]></description>',
    '  <link>https://www.realworkfromanywhere.com/jobs/data-platform-engineer-acme-labs-101</link>',
    '  <guid>https://www.realworkfromanywhere.com/jobs/data-platform-engineer-acme-labs-101</guid>',
    '  <pubDate>Tue, 27 Oct 2026 16:35:52 GMT</pubDate>',
    '  <author><![CDATA[Acme Labs]]></author>',
    '</item>',
    '<item>',
    '  <title>Head of Sales at ExampleCo &amp; Partners</title>',
    '  <link>https://www.realworkfromanywhere.com/jobs/head-of-sales-exampleco-102</link>',
    '  <author>ExampleCo &amp; Partners</author>',
    '</item>',
    '<item>',
    '  <title><![CDATA[Designer at Somewhere Else]]></title>',
    '  <link>https://www.realworkfromanywhere.com/jobs/designer-bigco-103</link>',
    '  <pubDate>not a date</pubDate>',
    '  <author><![CDATA[BigCo]]></author>',
    '</item>',
    '<item>',
    '  <title><![CDATA[Off-host at Acme]]></title>',
    '  <link>https://evil.example.com/jobs/x-1</link>',
    '  <author><![CDATA[Acme]]></author>',
    '</item>',
    '<item>',
    '  <title><![CDATA[Plain http at Acme]]></title>',
    '  <link>http://www.realworkfromanywhere.com/jobs/x-2</link>',
    '</item>',
    '<item>',
    '  <title></title>',
    '  <link>https://www.realworkfromanywhere.com/jobs/no-title-3</link>',
    '</item>',
    '</channel></rss>',
  ].join('\n');

  const jobs = parseRwfaFeed(sampleXml);
  if (jobs.length === 3) pass('keeps 3 valid items (drops off-host, http and title-less ones)');
  else fail(`parseRwfaFeed returned ${jobs.length} jobs, expected 3: ${JSON.stringify(jobs)}`);

  const [a, b, c] = jobs;
  if (a?.title === 'Data & Platform Engineer' && a?.company === 'Acme Labs' && a?.location === ''
    && a?.url === 'https://www.realworkfromanywhere.com/jobs/data-platform-engineer-acme-labs-101'
    && a?.postedAt === Date.parse('Tue, 27 Oct 2026 16:35:52 GMT')) {
    pass('company from <author>, " at {company}" suffix stripped, location left empty, pubDate → postedAt');
  } else fail(`row 0 = ${JSON.stringify(a)}`);
  if (b?.title === 'Head of Sales' && b?.company === 'ExampleCo & Partners' && !('postedAt' in b)) {
    pass('entity-encoded title/author are decoded before the suffix match; a missing pubDate omits postedAt');
  } else fail(`row 1 = ${JSON.stringify(b)}`);
  if (c?.title === 'Designer at Somewhere Else' && c?.company === 'BigCo' && !('postedAt' in c)) {
    pass('a suffix that does not match <author> is left in the title; an invalid pubDate is NaN-safe');
  } else fail(`row 2 = ${JSON.stringify(c)}`);

  // Empty vs broken
  if (parseRwfaFeed('<rss version="2.0"><channel><title>x</title></channel></rss>').length === 0) {
    pass('a well-formed channel with no items → []');
  } else fail('empty channel should yield []');
  for (const [label, body] of [['empty string', ''], ['null', null], ['an HTML page', '<html><body>Just a moment...</body></html>']]) {
    try {
      parseRwfaFeed(body);
      fail(`${label} should throw`);
    } catch (e) {
      if (/realworkfromanywhere: unexpected response/.test(e.message)) pass(`${label} → descriptive throw`);
      else fail(`${label} threw an unrelated error: ${e.message}`);
    }
  }

  // fetch() pins the request to the feed URL and passes redirect:'error'
  const calls = [];
  const fetched = await p.fetch(
    { name: 'RWFA', provider: 'realworkfromanywhere' },
    {
      sleep: async () => {},
      fetchText: async (url, options) => { calls.push({ url, options }); return sampleXml; },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (fetched.length === 3 && calls.length === 1 && calls[0].url === FEED_URL && calls[0].options?.redirect === 'error') {
    pass("fetch() requests the fixed feed URL once with redirect:'error'");
  } else fail(`fetch() calls=${JSON.stringify(calls)} jobs=${fetched.length}`);
} catch (e) {
  fail(`realworkfromanywhere provider tests crashed: ${e.message}`);
}
