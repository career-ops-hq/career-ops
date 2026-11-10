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
      'https://jobspresso.co/feed/job_feed/?posts_per_page=100'
  ) {
    pass('jobspresso.detect() claims explicit provider config');
  } else {
    fail('jobspresso.detect() failed');
  }

  if (
    jobspresso.detect({ provider: 'jobspresso', posts_per_page: 50 })?.url ===
      'https://jobspresso.co/feed/job_feed/?posts_per_page=50'
  ) {
    pass('jobspresso.detect() honours custom posts_per_page');
  } else {
    fail('jobspresso.detect() should honour custom posts_per_page');
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

  let fetchCalled = false;

  const fetched = await jobspresso.fetch({}, {
    async fetchText(url, opts) {
      fetchCalled = true;

      if (
        url !== 'https://jobspresso.co/feed/job_feed/?posts_per_page=100' ||
        opts?.redirect !== 'error'
      ) {
        throw new Error('unexpected fetch arguments');
      }

      return xml;
    },
  });

  if (fetchCalled && fetched.length === 1) {
    pass('jobspresso.fetch() requests the pinned RSS feed');
  } else {
    fail('jobspresso.fetch() did not fetch correctly');
  }

  let customFetchUrl = null;
  await jobspresso.fetch({ posts_per_page: 50 }, {
    async fetchText(url) {
      customFetchUrl = url;
      return xml;
    },
  });
  if (customFetchUrl === 'https://jobspresso.co/feed/job_feed/?posts_per_page=50') {
    pass('jobspresso.fetch() honors posts_per_page: 50 in request');
  } else {
    fail(`jobspresso.fetch() unexpected url: ${customFetchUrl}`);
  }

  let cappedFetchUrl = null;
  await jobspresso.fetch({ posts_per_page: 250 }, {
    async fetchText(url) {
      cappedFetchUrl = url;
      return xml;
    },
  });
  if (cappedFetchUrl === 'https://jobspresso.co/feed/job_feed/?posts_per_page=100') {
    pass('jobspresso.fetch() caps posts_per_page at 100 in request');
  } else {
    fail(`jobspresso.fetch() did not cap posts_per_page at 100: ${cappedFetchUrl}`);
  }

  const detectedUrl = jobspresso.detect({ provider: 'jobspresso' })?.url;
  if (detectedUrl && new URL(detectedUrl).searchParams.get('posts_per_page') === '100') {
    pass('jobspresso feed URL carries posts_per_page=100 (#6694)');
  } else {
    fail('jobspresso feed URL must carry posts_per_page=100');
  }

  if (fetchCalled) {
    pass('jobspresso.fetch() passes redirect:"error" to fetchText');
  } else {
    fail('jobspresso.fetch() never called fetchText');
  }

  // The full post in <content:encoded> is the description the scan filters
  // read. WordPress's <description> is only an excerpt, so it never stands in.
  const post = (inner) => `
<rss>
  <channel>
    <item>
      <title>Staff Engineer</title>
      <link>https://jobspresso.co/job/acme-staff-engineer/</link>
      <pubDate>Mon, 02 Jun 2025 12:00:00 GMT</pubDate>
      <job_listing:company><![CDATA[Acme]]></job_listing:company>
      ${inner}
    </item>
  </channel>
</rss>
`;
  const excerpt = '<description><![CDATA[Join Acme as we build the platform. As a]]></description>';

  const [full] = parseJobspressoFeed(post(excerpt +
    '<content:encoded><![CDATA[<p>Join Acme as we build the platform.</p>\n' +
    '<ul><li>R&amp;D on Rust &#8211; 5+ years</li></ul>\n' +
    '<p>We can&#8217;t sponsor visas.</p>]]></content:encoded>'));
  if (full?.description === 'Join Acme as we build the platform. R&D on Rust – 5+ years We can’t sponsor visas.') {
    pass('parseJobspressoFeed passes the full post through as plain-text description');
  } else {
    fail(`full-post description = ${JSON.stringify(full?.description)}`);
  }

  const noFullPost = [
    ['an excerpt-only item', excerpt],
    ['an empty full post', excerpt + '<content:encoded><![CDATA[]]></content:encoded>'],
    ['a whitespace full post', '<content:encoded><![CDATA[ \n ]]></content:encoded>'],
    ['a markup-only full post', '<content:encoded><![CDATA[<p></p><br />]]></content:encoded>'],
  ].filter(([, inner]) => {
    const [job] = parseJobspressoFeed(post(inner));
    return !job || 'description' in job;
  });
  if (noFullPost.length === 0) {
    pass('parseJobspressoFeed leaves description out for an excerpt-only, empty, whitespace or markup-only post');
  } else {
    fail(`description set for: ${noFullPost.map(([label]) => label).join(', ')}`);
  }

} catch (e) {
  fail(`jobspresso provider tests crashed: ${e.message}`);
}

