// tests/providers/startup-jobs.test.mjs — provider-contract tests for the
// Startup Jobs board-wide RSS provider (providers/startup-jobs.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — startup-jobs');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/startup-jobs.mjs')).href);
  const startupJobs = mod.default;
  const { parseStartupJobsFeed } = mod;

  if (startupJobs.id === 'startup-jobs') pass('startup-jobs.id is "startup-jobs"');
  else fail(`startup-jobs.id is ${JSON.stringify(startupJobs.id)}`);

  // detect() — explicit provider selection only (board-wide feed); the URL
  // is built from optional entry.startup_jobs query config.
  const hit = startupJobs.detect({ name: 'Startup Jobs', provider: 'startup-jobs' });
  if (hit && hit.url === 'https://startup.jobs/feeds/jobs') {
    pass('startup-jobs.detect() resolves provider:startup-jobs → bare feed URL with no config');
  } else {
    fail(`startup-jobs.detect() returned ${JSON.stringify(hit)}`);
  }

  const hitWithConfig = startupJobs.detect({
    name: 'Startup Jobs — Platform',
    provider: 'startup-jobs',
    startup_jobs: { role: 'platform-engineer', workplace: 'remote' },
  });
  if (
    hitWithConfig &&
    hitWithConfig.url === 'https://startup.jobs/feeds/jobs?role=platform-engineer&workplace=remote'
  ) {
    pass('startup-jobs.detect() builds the feed URL from entry.startup_jobs config');
  } else {
    fail(`startup-jobs.detect() with config returned ${JSON.stringify(hitWithConfig)}`);
  }

  // `country` is a confirmed no-op on this RSS endpoint (see provider header
  // comment) and is deliberately not read from entry.startup_jobs at all.
  const hitIgnoresCountry = startupJobs.detect({
    name: 'Startup Jobs — Platform',
    provider: 'startup-jobs',
    startup_jobs: { role: 'platform-engineer', country: 'NL' },
  });
  if (hitIgnoresCountry && hitIgnoresCountry.url === 'https://startup.jobs/feeds/jobs?role=platform-engineer') {
    pass('startup-jobs.detect() ignores an entry.startup_jobs.country field (confirmed no-op upstream)');
  } else {
    fail(`startup-jobs.detect() with country returned ${JSON.stringify(hitIgnoresCountry)}`);
  }

  if (startupJobs.detect({ name: 'X' }) === null) pass('startup-jobs.detect() returns null without provider:startup-jobs');
  else fail('startup-jobs.detect() should require provider:startup-jobs');

  // parseStartupJobsFeed — company parsed from "{title} at {Company}",
  // location parsed from the description's last line, utm query stripped.
  const sampleXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    '<title>Startup Jobs</title>',
    '<item>',
    '  <title>Senior Platform Engineer at Acme &amp; Co</title>',
    '  <link>https://startup.jobs/senior-platform-engineer-acme-10260824?utm_source=rss&amp;utm_medium=feed</link>',
    '  <guid isPermaLink="true">https://startup.jobs/senior-platform-engineer-acme-10260824</guid>',
    '  <pubDate>Thu, 01 Oct 2026 08:19:06 +0000</pubDate>',
    '  <description><![CDATA[Own the platform that powers the whole engineering org.',
    '',
    'Amsterdam, Netherlands · €130,000 – €160,000 per year]]></description>',
    '  <category>Engineering</category>',
    '</item>',
    '<item>',
    '  <title>Remote SRE at Beta Labs</title>',
    '  <link>https://startup.jobs/remote-sre-beta-labs-10260825</link>',
    '  <pubDate>Thu, 01 Oct 2026 08:10:00 +0000</pubDate>',
    '  <description>Remote, Germany</description>', // location-only, no body text, no comp
    '</item>',
    '<item>',
    '  <title>No At Segment Here</title>', // no " at " — employer unknown, row is skipped
    '  <link>https://startup.jobs/no-at-segment-10260826</link>',
    '  <description>Some body text.',
    '',
    'Remote, U.S.</description>',
    '</item>',
    '<item>',
    '  <title>Ghost (no link)</title>', // dropped — no URL
    '</item>',
    '</channel></rss>',
  ].join('\n');

  const jobs = parseStartupJobsFeed(sampleXml);
  if (jobs.length === 2) pass('parseStartupJobsFeed keeps 2 valid items (drops the link-less one and the unattributed one)');
  else fail(`parseStartupJobsFeed returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Senior Platform Engineer' && jobs[0]?.company === 'Acme & Co') {
    pass('parseStartupJobsFeed splits title/company on the last " at " and decodes entities');
  } else {
    fail(`row 0 title/company = ${JSON.stringify([jobs[0]?.title, jobs[0]?.company])}`);
  }
  if (jobs[0]?.location === 'Amsterdam, Netherlands') {
    pass('parseStartupJobsFeed extracts location from the description\'s last line, stripping the comp range');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }
  if (jobs[0]?.url === 'https://startup.jobs/senior-platform-engineer-acme-10260824') {
    pass('parseStartupJobsFeed strips the utm_* tracking query string from the URL');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }
  if (jobs[0]?.postedAt === Date.parse('Thu, 01 Oct 2026 08:19:06 +0000')) {
    pass('parseStartupJobsFeed parses pubDate → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.title === 'Remote SRE' && jobs[1]?.company === 'Beta Labs' && jobs[1]?.location === 'Remote, Germany') {
    pass('parseStartupJobsFeed handles a location-only description with no body text and no comp');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (jobs.every((j) => j.title !== 'No At Segment Here')) {
    pass('parseStartupJobsFeed skips a title with no usable " at " segment instead of attributing it to the board');
  } else {
    fail('the unattributed-employer item should have been dropped, not kept');
  }

  // description: the <description> text ships in the same payload, so it is
  // carried as plain text for content_filter / visa_filter (whitespace
  // collapsed, markup stripped by the shared htmlToText helper).
  if (jobs[0]?.description === 'Own the platform that powers the whole engineering org. Amsterdam, Netherlands · €130,000 – €160,000 per year') {
    pass('parseStartupJobsFeed carries the <description> text as job.description');
  } else {
    fail(`row 0 description = ${JSON.stringify(jobs[0]?.description)}`);
  }

  const descriptionXml = [
    '<rss><channel>',
    '<item>',
    '  <title>Backend Engineer at Gamma</title>',
    '  <link>https://startup.jobs/backend-engineer-gamma-10260827</link>',
    '  <description>&lt;p&gt;We sponsor &lt;strong&gt;visas&lt;/strong&gt; for this role.&lt;/p&gt;',
    '',
    'Berlin, Germany</description>',
    '</item>',
    '<item>',
    '  <title>Data Engineer at Delta</title>', // no <description> at all
    '  <link>https://startup.jobs/data-engineer-delta-10260828</link>',
    '</item>',
    '<item>',
    '  <title>Designer at Epsilon</title>', // empty <description>
    '  <link>https://startup.jobs/designer-epsilon-10260829</link>',
    '  <description></description>',
    '</item>',
    '</channel></rss>',
  ].join('\n');
  const descJobs = parseStartupJobsFeed(descriptionXml);
  if (descJobs[0]?.description === 'We sponsor visas for this role. Berlin, Germany' && descJobs[0]?.location === 'Berlin, Germany') {
    pass('parseStartupJobsFeed strips markup from job.description and still reads the location from the last line');
  } else {
    fail(`markup row = ${JSON.stringify(descJobs[0])}`);
  }
  if (descJobs.length === 3 && descJobs.slice(1).every((j) => !('description' in j) && j.location === '')) {
    pass('an item with no (or an empty) <description> is kept, without a description field');
  } else {
    fail(`description-less rows = ${JSON.stringify(descJobs.slice(1))}`);
  }

  // Robustness — envelope validation (providers/ADDING_A_PROVIDER.md
  // "Defensive parsing": a malformed envelope is a descriptive throw, never
  // a quiet `[]`, so an upstream break surfaces instead of reading as 0 jobs
  // forever). A genuinely empty <channel> (zero items) is still a valid
  // envelope and returns `[]` — that case is exercised separately below.
  let threwOnEmpty = false;
  try { parseStartupJobsFeed(''); } catch { threwOnEmpty = true; }
  if (threwOnEmpty) pass('empty input throws — not the documented <rss><channel> envelope');
  else fail('empty input should throw, not silently return []');

  let threwOnNull = false;
  try { parseStartupJobsFeed(null); } catch { threwOnNull = true; }
  if (threwOnNull) pass('null input throws — not a string, not the documented envelope');
  else fail('null input should throw, not silently return []');

  let threwOnHtml = false;
  try { parseStartupJobsFeed('<html><body>502 Bad Gateway</body></html>'); } catch { threwOnHtml = true; }
  if (threwOnHtml) pass('an HTML error page throws instead of reading as an empty board');
  else fail('an HTML error page should throw, not silently return []');

  let threwOnBareItem = false;
  try { parseStartupJobsFeed('<item><title>Bare at Co</title></item>'); } catch { threwOnBareItem = true; }
  if (threwOnBareItem) pass('a bare <item> with no <rss><channel> wrapper throws — truncated/malformed feed');
  else fail('a bare <item> with no envelope should throw, not silently return []');

  const emptyChannelJobs = parseStartupJobsFeed('<rss><channel></channel></rss>');
  if (emptyChannelJobs.length === 0) pass('a valid envelope with zero items is a genuinely empty board → []');
  else fail(`an empty <channel> should return [], got ${emptyChannelJobs.length} jobs`);

  // A non-startup.jobs link in <link> is dropped, never trusted as the job URL.
  const untrustedXml = [
    '<rss><channel>',
    '<item>',
    '  <title>Evil at Co</title>',
    '  <link>https://evil.example.com/job/1</link>',
    '</item>',
    '</channel></rss>',
  ].join('\n');
  if (parseStartupJobsFeed(untrustedXml).length === 0) pass('a link hosted off startup.jobs is dropped');
  else fail('a link hosted off startup.jobs should be dropped, not trusted');

  // fetch() pins the request to startup.jobs and passes redirect:'error'
  const fetchJobs = await startupJobs.fetch(
    { name: 'Startup Jobs', provider: 'startup-jobs', startup_jobs: { role: 'platform-engineer' } },
    {
      transport: 'http',
      fetchText: async (url, options) => {
        if (url !== 'https://startup.jobs/feeds/jobs?role=platform-engineer') {
          throw new Error(`fetchText called with unexpected URL: ${url}`);
        }
        if (options?.redirect !== 'error') throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        return sampleXml;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (fetchJobs.length === 2) pass('startup-jobs.fetch() hits the role-scoped feed with redirect:error and returns parsed jobs');
  else fail(`startup-jobs.fetch() returned ${fetchJobs.length} jobs, expected 2`);

} catch (e) {
  fail(`startup-jobs provider tests crashed: ${e.message}`);
}
