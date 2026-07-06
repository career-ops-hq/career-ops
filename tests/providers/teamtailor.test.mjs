// tests/providers/teamtailor.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — teamtailor');

try {
  const teamtailorModule = await import(pathToFileURL(join(ROOT, 'providers/teamtailor.mjs')).href);
  const teamtailor = teamtailorModule.default;
  const { parseTeamtailorFeed } = teamtailorModule;

  if (teamtailor.id === 'teamtailor') pass('teamtailor.id is "teamtailor"');
  else fail(`teamtailor.id is ${JSON.stringify(teamtailor.id)}`);

  // detect() — auto-detection from a <slug>.teamtailor.com careers_url, with
  // any path normalized to /jobs.rss.
  const hit = teamtailor.detect({ name: 'Podimo', careers_url: 'https://podimo.teamtailor.com/jobs' });
  if (hit && hit.url === 'https://podimo.teamtailor.com/jobs.rss') {
    pass('teamtailor.detect() resolves <slug>.teamtailor.com → /jobs.rss feed');
  } else {
    fail(`teamtailor.detect() returned ${JSON.stringify(hit)}`);
  }

  if (teamtailor.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('teamtailor.detect() returns null for non-teamtailor URLs');
  } else {
    fail('teamtailor.detect() should return null for non-teamtailor URLs');
  }

  // non-string careers_url → detect() returns null without crashing
  if (teamtailor.detect({ name: 'X', careers_url: null }) === null && teamtailor.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('teamtailor.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('teamtailor.detect() should treat non-string careers_url as missing');
  }

  // SSRF: teamtailor.com in the PATH (not host) must not be detected.
  if (teamtailor.detect({ name: 'Spoof', careers_url: 'https://evil.example/podimo.teamtailor.com/jobs' }) === null) {
    pass('teamtailor.detect() rejects path-spoofed URLs');
  } else {
    fail('teamtailor.detect() must NOT misdetect path-spoofed URLs');
  }

  // non-https careers_url is rejected
  if (teamtailor.detect({ name: 'X', careers_url: 'http://podimo.teamtailor.com/jobs' }) === null) {
    pass('teamtailor.detect() rejects non-https careers_url');
  } else {
    fail('teamtailor.detect() should reject non-https careers_url');
  }

  // parseTeamtailorFeed — RSS with tt: locations block and branded job link
  const sampleXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>',
    '<title>Podimo</title>',
    '<item>',
    '  <title>Sales Director &amp; Lead</title>',
    '  <link>https://careers.podimo.com/jobs/7950030-sales-director</link>',
    '  <pubDate>Mon, 22 Jun 2026 13:45:57 +0200</pubDate>',
    '  <remoteStatus>hybrid</remoteStatus>',
    '  <tt:locations><tt:location><tt:city>Oslo</tt:city><tt:country>Norway</tt:country></tt:location></tt:locations>',
    '</item>',
    '<item>',
    '  <title>Remote Engineer</title>',
    '  <link>https://podimo.teamtailor.com/jobs/123-remote-engineer</link>',
    '  <remoteStatus>fully</remoteStatus>',
    '</item>',
    '</channel></rss>',
  ].join('\n');

  const jobs = parseTeamtailorFeed(sampleXml, 'Podimo');
  if (jobs.length === 2) pass('parseTeamtailorFeed extracts 2 jobs from 2-item feed');
  else fail(`parseTeamtailorFeed returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Sales Director & Lead' && jobs[0]?.company === 'Podimo' && jobs[0]?.url === 'https://careers.podimo.com/jobs/7950030-sales-director') {
    pass('parseTeamtailorFeed decodes title entities, sets company, keeps branded-domain link');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.location === 'Oslo, Norway') {
    pass('parseTeamtailorFeed builds location from tt:city + tt:country');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}, expected "Oslo, Norway"`);
  }

  if (jobs[0]?.postedAt === Date.parse('Mon, 22 Jun 2026 13:45:57 +0200')) {
    pass('parseTeamtailorFeed parses pubDate → postedAt epoch ms');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.location === 'Remote' && jobs[1]?.postedAt === undefined) {
    pass('parseTeamtailorFeed falls back to "Remote" for fully-remote item with no place/date');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  // Robustness
  if (parseTeamtailorFeed('', 'X').length === 0) pass('empty input → empty result');
  else fail('empty input should yield empty result');

  if (parseTeamtailorFeed(null, 'X').length === 0) pass('null input → empty result (no crash)');
  else fail('null input should yield empty result without crashing');

  // A well-formed item with no <link> is skipped, not emitted with a blank URL.
  const noLink = parseTeamtailorFeed('<item><title>Ghost</title></item>', 'X');
  if (noLink.length === 0) pass('item without <link> is dropped');
  else fail(`item without <link> should be dropped, got ${JSON.stringify(noLink)}`);

  // fetch() pins the request to the teamtailor.com host on the happy path and
  // must pass redirect:'error' (asserting the SSRF guard, not just the URL).
  const fetchJobs = await teamtailor.fetch(
    { name: 'Podimo', careers_url: 'https://podimo.teamtailor.com/jobs' },
    {
      transport: 'http',
      fetchText: async (url, options) => {
        if (url !== 'https://podimo.teamtailor.com/jobs.rss') {
          throw new Error(`fetchText called with unexpected URL: ${url}`);
        }
        if (options?.redirect !== 'error') {
          throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        }
        return sampleXml;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (fetchJobs.length === 2) pass('teamtailor.fetch() hits /jobs.rss with redirect:error and returns parsed jobs');
  else fail(`teamtailor.fetch() returned ${fetchJobs.length} jobs, expected 2`);

  // Branded careers domain: auto-detection must NOT claim it (stays pinned to
  // *.teamtailor.com), but an explicit `provider: teamtailor` entry may fetch
  // the same /jobs.rss off the branded host the user configured.
  if (teamtailor.detect({ name: 'Podimo', careers_url: 'https://careers.podimo.com/jobs' }) === null) {
    pass('teamtailor.detect() does NOT auto-claim a branded (non-teamtailor.com) host');
  } else {
    fail('teamtailor.detect() must not auto-detect branded hosts');
  }

  const brandedJobs = await teamtailor.fetch(
    { name: 'Podimo', provider: 'teamtailor', careers_url: 'https://careers.podimo.com/jobs' },
    {
      transport: 'http',
      fetchText: async (url, options) => {
        if (url !== 'https://careers.podimo.com/jobs.rss') {
          throw new Error(`fetchText called with unexpected URL: ${url}`);
        }
        if (options?.redirect !== 'error') {
          throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        }
        return sampleXml;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (brandedJobs.length === 2) pass('explicit provider:teamtailor fetches /jobs.rss off a branded careers host');
  else fail(`branded-host fetch returned ${brandedJobs.length} jobs, expected 2`);

  // A branded host WITHOUT the explicit provider opt-in must still be refused by fetch().
  let brandedRefused = false;
  try {
    await teamtailor.fetch(
      { name: 'Podimo', careers_url: 'https://careers.podimo.com/jobs' },
      {
        transport: 'http',
        fetchText: async () => { throw new Error('fetchText should not be reached'); },
        fetchJson: async () => { throw new Error('fetchJson should not be called'); },
      },
    );
  } catch {
    brandedRefused = true;
  }
  if (brandedRefused) pass('teamtailor.fetch() refuses a branded host without explicit provider:teamtailor');
  else fail('teamtailor.fetch() should refuse a branded host when not explicitly configured');

} catch (e) {
  fail(`teamtailor provider tests crashed: ${e.message}`);
}

