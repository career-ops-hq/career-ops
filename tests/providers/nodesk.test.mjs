// tests/providers/nodesk.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — nodesk');

try {
  const {
    default: nodesk,
    parseNodeskFeed,
  } = await import(pathToFileURL(join(ROOT, 'providers/nodesk.mjs')).href);

  if (nodesk.id === 'nodesk') {
    pass('nodesk.id is "nodesk"');
  } else {
    fail(`nodesk.id is "${nodesk.id}"`);
  }

  if (
    nodesk.detect({ provider: 'nodesk' })?.url ===
      'https://nodesk.co/remote-jobs/index.xml'
  ) {
    pass('nodesk.detect() claims explicit provider config');
  } else {
    fail('nodesk.detect() failed');
  }

  if (nodesk.detect({ provider: 'other' }) === null) {
    pass('nodesk.detect() ignores other provider ids');
  } else {
    fail('nodesk.detect() should ignore other providers');
  }

  const xml = `
<rss>
  <channel>
    <item>
      <title><![CDATA[Senior Backend Engineer at Acme]]></title>
      <link>https://nodesk.co/remote-jobs/acme-senior-backend-engineer/</link>
      <pubDate>Mon, 02 Jun 2025 12:00:00 GMT</pubDate>
    </item>

    <item>
      <title>Platform Engineer at Example Corp</title>
      <link>https://nodesk.co/remote-jobs/example-platform-engineer/</link>
      <pubDate>not-a-date</pubDate>
    </item>

    <item>
      <title>Bad Host at Evil Inc</title>
      <link>https://evil.com/job</link>
    </item>

    <item>
      <title></title>
      <link>https://nodesk.co/remote-jobs/skip-empty-title/</link>
    </item>
  </channel>
</rss>
`;

  const jobs = parseNodeskFeed(xml);

  if (jobs.length === 2) {
    pass('parseNodeskFeed keeps valid items and drops malformed ones');
  } else {
    fail(`expected 2 jobs, got ${jobs.length}`);
  }

  if (
    jobs[0]?.title === 'Senior Backend Engineer' &&
    jobs[0]?.company === 'Acme' &&
    jobs[0]?.location === '' &&
    jobs[0]?.url === 'https://nodesk.co/remote-jobs/acme-senior-backend-engineer/' &&
    typeof jobs[0]?.postedAt === 'number'
  ) {
    pass('parseNodeskFeed maps title, company, location, url and postedAt');
  } else {
    fail(`unexpected first parsed job: ${JSON.stringify(jobs[0])}`);
  }

  if (
    jobs[1]?.title === 'Platform Engineer' &&
    jobs[1]?.company === 'Example Corp' &&
    !('postedAt' in jobs[1])
  ) {
    pass('parseNodeskFeed is NaN-safe for invalid dates');
  } else {
    fail(`unexpected second parsed job: ${JSON.stringify(jobs[1])}`);
  }

  let fetchCalled = false;

  const fetched = await nodesk.fetch({}, {
    async fetchText(url, opts) {
      fetchCalled = true;

      if (
        url !== 'https://nodesk.co/remote-jobs/index.xml' ||
        opts?.redirect !== 'error'
      ) {
        throw new Error('unexpected fetch arguments');
      }

      return xml;
    },
  });

  if (fetchCalled && fetched.length === 2) {
    pass('nodesk.fetch() requests the pinned RSS feed');
  } else {
    fail('nodesk.fetch() did not fetch correctly');
  }

  if (fetchCalled) {
    pass('nodesk.fetch() passes redirect:"error" to fetchText');
  } else {
    fail('nodesk.fetch() never called fetchText');
  }

} catch (e) {
  fail(`nodesk provider tests crashed: ${e.message}`);
}

