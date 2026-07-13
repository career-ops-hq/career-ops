// tests/providers/weworkremotely.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — weworkremotely');


try {
  const wwrModule = await import(pathToFileURL(join(ROOT, 'providers/weworkremotely.mjs')).href);
  const weworkremotely = wwrModule.default;
  const { parseWwrFeed } = wwrModule;

  if (weworkremotely.id === 'weworkremotely') pass('weworkremotely.id is "weworkremotely"');
  else fail(`weworkremotely.id is ${JSON.stringify(weworkremotely.id)}`);

  const hit = weworkremotely.detect({ name: 'WWR', provider: 'weworkremotely' });
  if (hit && hit.url === 'https://weworkremotely.com/remote-jobs.rss') {
    pass('weworkremotely.detect() claims explicit provider config');
  } else {
    fail(`weworkremotely.detect() returned ${JSON.stringify(hit)}`);
  }

  if (weworkremotely.detect({ name: 'Remote Board', provider: 'remoteok' }) === null) {
    pass('weworkremotely.detect() ignores other provider ids');
  } else {
    fail('weworkremotely.detect() should only claim provider: weworkremotely');
  }

  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Acme & Co: Staff AI Engineer]]></title>
      <link>https://weworkremotely.com/remote-jobs/acme-staff-ai-engineer</link>
      <pubDate>Thu, 13 Nov 2025 14:10:41 +0000</pubDate>
      <region><![CDATA[Anywhere in the World]]></region>
      <category>Programming</category>
    </item>
    <item>
      <title>Principal Platform Engineer &amp; Tooling</title>
      <link>https://weworkremotely.com/remote-jobs/example-platform-engineer</link>
      <pubDate>Fri, 02 Jan 2026 09:00:00 +0000</pubDate>
      <category>DevOps and Sysadmin</category>
    </item>
    <item>
      <title>Missing Link Inc: Dropped Role</title>
      <pubDate>Fri, 02 Jan 2026 09:00:00 +0000</pubDate>
      <region>USA Only</region>
    </item>
    <item>
      <title>Bad Link Inc: Dropped Role</title>
      <link>/remote-jobs/bad-link</link>
      <region>Europe Only</region>
    </item>
    <item>
      <title>Off Host Inc: Dropped Role</title>
      <link>https://example.com/remote-jobs/off-host</link>
      <region>Internal</region>
    </item>
  </channel>
</rss>`;
  const jobs = parseWwrFeed(sample, 'WWR Board');

  if (jobs.length === 2) pass('parseWwrFeed keeps 2 items (drops missing/relative/off-host links)');
  else fail(`parseWwrFeed returned ${jobs.length} jobs (expected 2)`);

  if (jobs[0]?.company === 'Acme & Co' && jobs[0]?.title === 'Staff AI Engineer') {
    pass('parseWwrFeed splits "Company: Role" titles');
  } else {
    fail(`row 0 title/company = ${JSON.stringify({ title: jobs[0]?.title, company: jobs[0]?.company })}`);
  }

  if (jobs[0]?.url === 'https://weworkremotely.com/remote-jobs/acme-staff-ai-engineer') {
    pass('parseWwrFeed maps <link> to url');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.location === 'Anywhere in the World') {
    pass('parseWwrFeed maps <region> to location');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('Thu, 13 Nov 2025 14:10:41 +0000')) {
    pass('parseWwrFeed parses pubDate -> postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.company === 'WWR Board' && jobs[1]?.title === 'Principal Platform Engineer & Tooling') {
    pass('parseWwrFeed falls back to entry name and decodes entities');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (jobs[1]?.location === 'DevOps and Sysadmin') {
    pass('parseWwrFeed falls back to <category> when <region> is absent');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}`);
  }

  if (parseWwrFeed('', 'X').length === 0 && parseWwrFeed(null, 'X').length === 0) {
    pass('parseWwrFeed empty / non-string feed -> empty result (no crash)');
  } else {
    fail('parseWwrFeed empty / non-string feed should yield empty result');
  }

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await weworkremotely.fetch(
    { name: 'WWR Board', provider: 'weworkremotely' },
    { fetchText: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://weworkremotely.com/remote-jobs.rss') {
    pass('weworkremotely.fetch() requests the pinned RSS feed URL');
  } else {
    fail(`weworkremotely.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('weworkremotely.fetch() passes redirect:"error" to fetchText');
  } else {
    fail(`weworkremotely.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched[0]?.company === 'Acme & Co' && fetched[0]?.title === 'Staff AI Engineer') {
    pass('provider: weworkremotely config returns normalized jobs');
  } else {
    fail(`weworkremotely.fetch() normalized row = ${JSON.stringify(fetched[0])}`);
  }
} catch (e) {
  fail(`weworkremotely provider tests crashed: ${e.message}`);
}

