// tests/providers/higheredjobs.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — higheredjobs');

try {
  const hejModule = await import(pathToFileURL(join(ROOT, 'providers/higheredjobs.mjs')).href);
  const higheredjobs = hejModule.default;
  const { parseHigherEdJobsFeed } = hejModule;

  if (higheredjobs.id === 'higheredjobs') pass('higheredjobs.id is "higheredjobs"');
  else fail(`higheredjobs.id is ${JSON.stringify(higheredjobs.id)}`);

  const hit = higheredjobs.detect({ name: 'HEJ', provider: 'higheredjobs', cat_id: 64 });
  if (hit && hit.url === 'https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=64') {
    pass('higheredjobs.detect() claims explicit provider config (returns URL with catID)');
  } else {
    fail(`higheredjobs.detect() returned ${JSON.stringify(hit)}`);
  }

  const hitDefault = higheredjobs.detect({ name: 'HEJ', provider: 'higheredjobs' });
  if (hitDefault && hitDefault.url === 'https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=68') {
    pass('higheredjobs.detect() with no cat_id returns default URL with catID=68');
  } else {
    fail(`higheredjobs.detect() default returned ${JSON.stringify(hitDefault)}`);
  }

  if (higheredjobs.detect({ name: 'Remote Board', provider: 'remoteok' }) === null) {
    pass('higheredjobs.detect() ignores other provider ids');
  } else {
    fail('higheredjobs.detect() should only claim provider: higheredjobs');
  }

  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Director of AI Strategy]]></title>
      <description><![CDATA[Curry College (Milton, MA)]]></description>
      <link>https://www.higheredjobs.com/details.cfm?JobCode=17899012</link>
      <pubDate>Thu, 13 Nov 2025 14:10:41 +0000</pubDate>
      <guid>https://www.higheredjobs.com/details.cfm?JobCode=17899012</guid>
    </item>
    <item>
      <title>Dean of Engineering &amp; Computing</title>
      <description>State University System Office</description>
      <link>https://www.higheredjobs.com/details.cfm?JobCode=17899044</link>
      <pubDate>Fri, 02 Jan 2026 09:00:00 +0000</pubDate>
      <guid>https://www.higheredjobs.com/details.cfm?JobCode=17899044</guid>
    </item>
    <item>
      <title>Missing Link Role</title>
      <description>Ghost College (Nowhere, ZZ)</description>
      <pubDate>Fri, 02 Jan 2026 09:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Relative Link Role</title>
      <description>Relative U (Somewhere, ST)</description>
      <link>/details.cfm?JobCode=bad-relative</link>
      <pubDate>Fri, 02 Jan 2026 09:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Off Host Role</title>
      <description>Off Host Inst (Elsewhere, ST)</description>
      <link>https://example.com/details.cfm?JobCode=off-host</link>
      <pubDate>Fri, 02 Jan 2026 09:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;
  const jobs = parseHigherEdJobsFeed(sample, 'HEJ Board');

  if (jobs.length === 2) pass('parseHigherEdJobsFeed keeps 2 items (drops missing/relative/off-host links)');
  else fail(`parseHigherEdJobsFeed returned ${jobs.length} jobs (expected 2)`);

  if (jobs.every(({ url }) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === 'www.higheredjobs.com';
    } catch {
      return false;
    }
  })) pass('parseHigherEdJobsFeed only emits HTTPS URLs pinned to www.higheredjobs.com');
  else fail('parseHigherEdJobsFeed emitted an off-host or non-HTTPS URL');

  if (jobs[0]?.title === 'Director of AI Strategy' && jobs[0]?.company === 'Curry College' && jobs[0]?.location === 'Milton, MA') {
    pass('parseHigherEdJobsFeed parses title + "Institution (City, ST)" description -> company/title/location');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://www.higheredjobs.com/details.cfm?JobCode=17899012') {
    pass('parseHigherEdJobsFeed maps <link> to url');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('Thu, 13 Nov 2025 14:10:41 +0000')) {
    pass('parseHigherEdJobsFeed parses pubDate -> postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.company === 'State University System Office' && jobs[1]?.location === '' && jobs[1]?.title === 'Dean of Engineering & Computing') {
    pass('parseHigherEdJobsFeed falls back to whole description as company when no parens (empty location)');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (parseHigherEdJobsFeed('', 'X').length === 0 && parseHigherEdJobsFeed(null, 'X').length === 0) {
    pass('parseHigherEdJobsFeed empty / non-string feed -> empty result (no crash)');
  } else {
    fail('parseHigherEdJobsFeed empty / non-string feed should yield empty result');
  }

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await higheredjobs.fetch(
    { name: 'HEJ Board', provider: 'higheredjobs', cat_id: 64 },
    { fetchText: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=64') {
    pass('higheredjobs.fetch() requests the feed URL for cat_id 64');
  } else {
    fail(`higheredjobs.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('higheredjobs.fetch() passes redirect:"error" to fetchText');
  } else {
    fail(`higheredjobs.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched[0]?.company === 'Curry College' && fetched[0]?.title === 'Director of AI Strategy' && fetched[0]?.location === 'Milton, MA') {
    pass('provider: higheredjobs config returns normalized jobs');
  } else {
    fail(`higheredjobs.fetch() normalized row = ${JSON.stringify(fetched[0])}`);
  }
} catch (e) {
  fail(`higheredjobs provider tests crashed: ${e.message}`);
}

