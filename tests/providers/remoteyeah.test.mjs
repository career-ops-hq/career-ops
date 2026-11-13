// tests/providers/remoteyeah.test.mjs — provider-contract tests for the
// RemoteYeah board-wide RSS provider (providers/remoteyeah.mjs). Fixtures are
// invented.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — remoteyeah');

const FEED_URL = 'https://remoteyeah.com/rss.xml';

const item = ({ title, company, location = 'United States', pubDate = '2026-10-28T12:31:12+00:00', guid, link }) => `
  <item>
    <title> ${title} </title>
    <company> ${company} </company>
    <description><![CDATA[<ul><li>Skills: Go</li></ul>]]></description>
    <category> Engineer </category>
    <location> ${location} </location>
    <pubDate>${pubDate}</pubDate>
    <guid isPermaLink="false">${guid}</guid>
    <link>${link}</link>
  </item>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/remoteyeah.mjs')).href);
  const p = mod.default;
  const { parseRemoteYeahFeed, cleanRemoteYeahTitle } = mod;

  if (p.id === 'remoteyeah') pass('id is "remoteyeah"');
  else fail(`id=${JSON.stringify(p.id)}`);

  // detect() — explicit provider selection only (board-wide feed)
  const hit = p.detect({ name: 'RemoteYeah', provider: 'remoteyeah' });
  if (hit && hit.url === FEED_URL) pass('detect() resolves provider:remoteyeah → feed URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (p.detect({ name: 'X', careers_url: 'https://remoteyeah.com/' }) === null && p.detect(null) === null) {
    pass('detect() returns null without provider:remoteyeah (no throw on null)');
  } else fail('detect() should be explicit-only');

  // cleanRemoteYeahTitle — strips only provably-added decoration
  const cases = [
    [['Remote Platform Engineer at Acme', 'Acme', 'remote-platform-engineer-acme-2', 'platform-engineer-acme-2'], 'Platform Engineer'],
    [['Remote Remote Sensing Engineer at Acme', 'Acme', 'remote-remote-sensing-engineer-acme', 'remote-sensing-engineer-acme'], 'Remote Sensing Engineer'],
    [['Remote Engineer at Acme', 'Acme', 'remote-engineer-acme', 'other-guid'], 'Remote Engineer'],
    [['Remote Engineer at Somebody', 'Acme', 'remote-engineer-acme', 'engineer-acme'], 'Engineer at Somebody'],
  ];
  if (cases.every(([args, want]) => cleanRemoteYeahTitle(...args) === want)) {
    pass('cleanRemoteYeahTitle strips " at {company}" only on an exact match and "Remote " only when slug = remote-{guid}');
  } else fail(`cleanRemoteYeahTitle = ${JSON.stringify(cases.map(([args]) => cleanRemoteYeahTitle(...args)))}`);

  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>Remote jobs</title>
  ${item({ title: 'Remote Data &amp; ML Engineer at Acme &amp; Co', company: 'Acme &amp; Co', location: 'United Kingdom', guid: 'data-ml-engineer-acme-co', link: 'https://remoteyeah.com/jobs/remote-data-ml-engineer-acme-co?utm_source=rss&amp;ref=rss' })}
  ${item({ title: 'Remote Backend Engineer at BigCo', company: 'BigCo', location: '', pubDate: 'garbage', guid: 'backend-engineer-bigco', link: 'https://remoteyeah.com/jobs/remote-backend-engineer-bigco?utm_source=rss&amp;ref=rss' })}
  ${item({ title: 'Remote Backend Engineer at BigCo', company: 'BigCo', guid: 'backend-engineer-bigco', link: 'https://remoteyeah.com/jobs/remote-backend-engineer-bigco?ref=other' })}
  ${item({ title: 'Remote Off-host at Acme', company: 'Acme', guid: 'off-host-acme', link: 'https://evil.example.com/jobs/remote-off-host-acme' })}
  ${item({ title: 'Remote Plain http at Acme', company: 'Acme', guid: 'plain-acme', link: 'http://remoteyeah.com/jobs/remote-plain-acme' })}
  ${item({ title: '', company: 'Acme', guid: 'empty', link: 'https://remoteyeah.com/jobs/remote-empty' })}
</channel></rss>`;

  const jobs = parseRemoteYeahFeed(sampleXml);
  if (jobs.length === 2) pass('keeps 2 valid items (drops a duplicate URL, off-host, http and title-less ones)');
  else fail(`parseRemoteYeahFeed returned ${jobs.length} jobs: ${JSON.stringify(jobs)}`);

  const [a, b] = jobs;
  if (a?.title === 'Data & ML Engineer' && a?.company === 'Acme & Co' && a?.location === 'United Kingdom'
    && a?.url === 'https://remoteyeah.com/jobs/remote-data-ml-engineer-acme-co'
    && a?.postedAt === Date.parse('2026-10-28T12:31:12+00:00')) {
    pass('decodes entities, reads company/location fields, strips tracking params from the URL, ISO pubDate → postedAt');
  } else fail(`row 0 = ${JSON.stringify(a)}`);
  if (b?.title === 'Backend Engineer' && b?.company === 'BigCo' && b?.location === '' && !('postedAt' in b)) {
    pass('an empty location stays empty and an invalid pubDate is NaN-safe');
  } else fail(`row 1 = ${JSON.stringify(b)}`);

  // Empty vs broken
  if (parseRemoteYeahFeed('<rss version="2.0"><channel><title>x</title></channel></rss>').length === 0) {
    pass('a well-formed channel with no items → []');
  } else fail('empty channel should yield []');
  for (const [label, body] of [['empty string', ''], ['undefined', undefined], ['an HTML page', '<!DOCTYPE html><html><body>Error</body></html>']]) {
    try {
      parseRemoteYeahFeed(body);
      fail(`${label} should throw`);
    } catch (e) {
      if (/remoteyeah: unexpected response/.test(e.message)) pass(`${label} → descriptive throw`);
      else fail(`${label} threw an unrelated error: ${e.message}`);
    }
  }

  // fetch() pins the request to the feed URL and passes redirect:'error'
  const calls = [];
  const fetched = await p.fetch(
    { name: 'RemoteYeah', provider: 'remoteyeah' },
    {
      sleep: async () => {},
      fetchText: async (url, options) => { calls.push({ url, options }); return sampleXml; },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (fetched.length === 2 && calls.length === 1 && calls[0].url === FEED_URL && calls[0].options?.redirect === 'error') {
    pass("fetch() requests the fixed feed URL once with redirect:'error'");
  } else fail(`fetch() calls=${JSON.stringify(calls)} jobs=${fetched.length}`);
} catch (e) {
  fail(`remoteyeah provider tests crashed: ${e.message}`);
}
