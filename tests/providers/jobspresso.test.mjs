// tests/providers/jobspresso.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobspresso');

try {
  const {
    default: jobspresso,
    parseJobspressoFeed,
  } = await import(pathToFileURL(join(ROOT, 'providers/jobspresso.mjs')).href);

  if (jobspresso.id === 'jobspresso') {
    pass('jobspresso.id is "jobspresso"');
  } else {
    fail(`jobspresso.id is "${jobspresso.id}"`);
  }

  if (
    jobspresso.detect({ provider: 'jobspresso' })?.url ===
      'https://jobspresso.co/?feed=job_feed'
  ) {
    pass('jobspresso.detect() claims explicit provider config');
  } else {
    fail('jobspresso.detect() failed');
  }

  if (jobspresso.detect({ provider: 'other' }) === null) {
    pass('jobspresso.detect() ignores other provider ids');
  } else {
    fail('jobspresso.detect() should ignore other providers');
  }

  const xml = `
<rss>
  <channel>
    <item>
      <title><![CDATA[Senior Backend Engineer]]></title>
      <link>https://jobspresso.co/job/acme/backend</link>
      <pubDate>Mon, 02 Jun 2025 12:00:00 GMT</pubDate>
      <job_listing:company><![CDATA[Acme]]></job_listing:company>
      <job_listing:location><![CDATA[Remote]]></job_listing:location>
    </item>

    <item>
      <title></title>
      <link>https://jobspresso.co/job/skip</link>
    </item>

    <item>
      <title>Bad Host</title>
      <link>https://evil.com/job</link>
    </item>
  </channel>
</rss>
`;

  const jobs = parseJobspressoFeed(xml);

  if (jobs.length === 1) {
    pass('parseJobspressoFeed keeps valid items and drops malformed ones');
  } else {
    fail(`expected 1 job, got ${jobs.length}`);
  }

  const job = jobs[0];

  if (
    job.title === 'Senior Backend Engineer' &&
    job.company === 'Acme' &&
    job.location === 'Remote' &&
    job.url === 'https://jobspresso.co/job/acme/backend' &&
    typeof job.postedAt === 'number'
  ) {
    pass('parseJobspressoFeed maps title, url, company, location and postedAt');
  } else {
    fail(`unexpected parsed job: ${JSON.stringify(job)}`);
  }

  // fetch() — retired (#5774): throws immediately, names the cause, and never
  // touches the network (jobspresso.co's robots.txt disallows the feed path).
  let networkCalls = 0;
  const ctx = {
    transport: 'http',
    fetchText: async (url) => {
      networkCalls++;
      throw new Error(`fetchText should not be called, got: ${url}`);
    },
    fetchJson: async (url) => {
      networkCalls++;
      throw new Error(`fetchJson should not be called, got: ${url}`);
    },
  };
  let fetchErr = null;
  try {
    await jobspresso.fetch({ name: 'Jobspresso', provider: 'jobspresso' }, ctx);
  } catch (e) {
    fetchErr = e;
  }
  if (networkCalls === 0 && fetchErr && /robots\.txt/.test(fetchErr.message) && /#5774/.test(fetchErr.message)) {
    pass('jobspresso.fetch() throws a retirement message naming the cause (#5774) without touching the network');
  } else {
    fail(`jobspresso.fetch() should throw a retirement message with zero network calls, got: networkCalls=${networkCalls}, error=${fetchErr ? fetchErr.message : '(did not throw)'}`);
  }

} catch (e) {
  fail(`jobspresso provider tests crashed: ${e.message}`);
}

