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

  // Pagination. The feed serves 100 items per request; ?offset= walks past
  // them (observed live: ?page= is ignored, a short page marks the end).
  const feedOf = (from, count) => [
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Acme</title>',
    ...Array.from({ length: count }, (_, i) =>
      `<item><title>Role ${from + i}</title><link>https://acme.example.com/jobs/${from + i}</link></item>`),
    '</channel></rss>',
  ].join('\n');
  const TOTAL = 250;
  const acme = { name: 'Acme', careers_url: 'https://acme.teamtailor.com/jobs' };
  const offsetOf = (url) => Number(new URL(url).searchParams.get('offset') || 0);
  const serve = (total, log) => async (url, options) => {
    log.push({ url, redirect: options?.redirect });
    const offset = offsetOf(url);
    return feedOf(offset, Math.max(0, Math.min(100, total - offset)));
  };
  const mkCtx = (fetchText, extra = {}) => ({
    transport: 'http',
    fetchText,
    fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    sleep: async () => {},
    ...extra,
  });
  // Run fn with console.error captured; returns { out, warnings }.
  const quietly = async (fn) => {
    const warnings = [];
    const orig = console.error;
    console.error = (...a) => warnings.push(a.join(' '));
    try { return { out: await fn(), warnings }; } finally { console.error = orig; }
  };

  {
    const log = [];
    const out = await teamtailor.fetch(acme, mkCtx(serve(TOTAL, log)));
    if (out.length === TOTAL && !out.truncated) pass('teamtailor.fetch() walks ?offset= pages to the end (250 items, not marked truncated)');
    else fail(`pagination returned ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
    const urls = log.map((r) => r.url);
    if (urls.join(' ') === 'https://acme.teamtailor.com/jobs.rss https://acme.teamtailor.com/jobs.rss?offset=100 https://acme.teamtailor.com/jobs.rss?offset=200') {
      pass('teamtailor.fetch() asks for the bare feed, offset 100, offset 200 and stops on the short page');
    } else fail(`requests: ${urls.join(' ')}`);
    if (log.every((r) => r.redirect === 'error')) pass("teamtailor.fetch() passes redirect:'error' on every page request");
    else fail(`a page request lacked redirect:'error': ${JSON.stringify(log)}`);
  }

  {
    // An exact multiple of the page size: the empty page after it ends the walk.
    const log = [];
    const out = await teamtailor.fetch(acme, mkCtx(serve(200, log)));
    if (out.length === 200 && log.length === 3 && !out.truncated) pass('teamtailor.fetch() ends on an empty page after a full one (200 items, 3 requests)');
    else fail(`200-item board: ${out.length} jobs, ${log.length} requests`);
  }

  {
    // The short page wins over the ceiling: max_pages 3 on a 250-item board.
    const log = [];
    const out = await teamtailor.fetch({ ...acme, max_pages: 3 }, mkCtx(serve(TOTAL, log)));
    if (out.length === TOTAL && !out.truncated && log.length === 3) pass('teamtailor.fetch() short last page wins over max_pages (no truncation marker)');
    else fail(`short page at the ceiling: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    const log = [];
    const { out, warnings } = await quietly(() => teamtailor.fetch({ ...acme, max_pages: 2 }, mkCtx(serve(TOTAL, log))));
    if (out.length === 200 && log.length === 2 && out.truncated?.reason === 'page-cap' && out.truncated?.fetched === 200) {
      pass('teamtailor.fetch() marks page-cap truncation when max_pages stops a full page');
    } else fail(`max_pages 2: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
    if (warnings.some((w) => /raise max_pages/.test(w))) pass('teamtailor.fetch() warns to raise max_pages on a ceiling stop');
    else fail(`no raise-max_pages warning: ${JSON.stringify(warnings)}`);
  }

  {
    // ctx.maxPages: the health probe makes exactly one request, no marker, no warning.
    const log = [];
    const { out, warnings } = await quietly(() => teamtailor.fetch(acme, mkCtx(serve(TOTAL, log), { maxPages: 1 })));
    if (log.length === 1 && out.length === 100 && !out.truncated && warnings.length === 0) {
      pass('teamtailor.fetch() under ctx.maxPages:1 makes exactly one request, unmarked and silent');
    } else fail(`probe: ${log.length} requests, ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}, warnings=${warnings.length}`);
  }

  {
    // max_pages is clamped by the provider's own hard cap, whatever the entry says.
    let requests = 0;
    const { out } = await quietly(() => teamtailor.fetch({ ...acme, max_pages: 100000 }, mkCtx(async (url) => {
      requests++;
      return feedOf(offsetOf(url), 100); // a board that never ends
    })));
    if (requests === 100 && out.truncated?.reason === 'page-cap') pass('teamtailor.fetch() never exceeds its hard page cap on a feed that never ends');
    else fail(`endless feed: ${requests} requests, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    // The hard ceiling is not something the operator can raise: the warning says so.
    const { warnings } = await quietly(() => teamtailor.fetch({ ...acme, max_pages: 100 }, mkCtx(async (url) => feedOf(offsetOf(url), 100))));
    if (warnings.length === 1 && !/raise max_pages/.test(warnings[0]) && /hard ceiling/.test(warnings[0])) pass('teamtailor.fetch() does not advise raising max_pages at the hard cap');
    else fail(`hard-cap warnings: ${JSON.stringify(warnings)}`);
  }

  {
    // A probe cap equal to the entry's max_pages is the probe's budget, not a truncation.
    const log = [];
    const { out, warnings } = await quietly(() => teamtailor.fetch({ ...acme, max_pages: 1 }, mkCtx(serve(TOTAL, log), { maxPages: 1 })));
    if (log.length === 1 && !out.truncated && warnings.length === 0) pass('teamtailor.fetch() gives the probe budget precedence when it ties with max_pages');
    else fail(`tie: ${log.length} requests, truncated=${JSON.stringify(out.truncated)}, warnings=${warnings.length}`);
  }

  {
    // The sweep discards a board that outlives its 5-minute watchdog, so the walk stops
    // on its own clock first and returns the pages already read, marked partial.
    const realNow = Date.now;
    let clock = 0;
    Date.now = () => clock;
    try {
      let requests = 0;
      const { out, warnings } = await quietly(() => teamtailor.fetch({ ...acme, max_pages: 50 }, mkCtx(async (url) => {
        requests++;
        clock += 100_000; // a slow board: 100 s per page
        return feedOf(offsetOf(url), 100);
      })));
      if (out.length === 300 && requests === 3 && out.truncated?.reason === 'time-budget' && out.truncated?.fetched === 300) {
        pass('teamtailor.fetch() keeps the pages read and marks time-budget when its walk budget runs out');
      } else fail(`time budget: ${out.length} jobs, ${requests} requests, truncated=${JSON.stringify(out.truncated)}`);
      if (warnings.length === 1 && !/raise max_pages/.test(warnings[0])) pass('teamtailor.fetch() time-budget stop does not claim the ceiling truncated the board');
      else fail(`time-budget warnings: ${JSON.stringify(warnings)}`);
    } finally {
      Date.now = realNow;
    }
  }

  {
    // An empty <item/> still counts toward a full page: 99 usable items plus one empty one
    // is a full page, so the next offset is requested.
    const log = [];
    const pages = [feedOf(0, 99).replace('</channel>', '<item/></channel>'), feedOf(100, 5)];
    const out = await teamtailor.fetch(acme, mkCtx(async (url) => { log.push(url); return pages[log.length - 1]; }));
    if (log.length === 2 && out.length === 104 && !out.truncated) pass('teamtailor.fetch() counts an empty <item/> toward a full page');
    else fail(`empty item: ${log.length} requests, ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    // A full page whose rows the parser drops (no link) is not a repeat: the walk goes on.
    const linkless = '<?xml version="1.0"?><rss><channel>' + Array.from({ length: 100 }, (_, i) => `<item><title>No link ${i}</title></item>`).join('') + '</channel></rss>';
    const pages = [feedOf(0, 100), linkless, feedOf(200, 7)];
    let n = 0;
    const { out } = await quietly(() => teamtailor.fetch(acme, mkCtx(async () => pages[n++])));
    if (out.length === 107 && n === 3 && !out.truncated) pass('teamtailor.fetch() does not report offset-ignored for a page of unusable rows');
    else fail(`unusable page: ${out.length} jobs, ${n} requests, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    // The feed shifts while it is walked: a posting repeated on the next page is kept once.
    const pages = [feedOf(0, 100), feedOf(99, 51)]; // item 99 appears on both pages
    let n = 0;
    const out = await teamtailor.fetch(acme, mkCtx(async () => pages[n++]));
    if (out.length === 150 && new Set(out.map((j) => j.url)).size === 150) pass('teamtailor.fetch() dedups postings repeated across pages by URL');
    else fail(`dedup: ${out.length} jobs`);
  }

  {
    // A server that ignores ?offset= and returns the same 100 items ends the
    // walk, and the board is marked partial: the rest of it was not reached.
    let n = 0;
    const { out, warnings } = await quietly(() => teamtailor.fetch(acme, mkCtx(async () => { n++; return feedOf(0, 100); })));
    if (out.length === 100 && n === 2 && out.truncated?.reason === 'offset-ignored') pass('teamtailor.fetch() stops when a page adds nothing new and marks the board partial (offset ignored)');
    else fail(`ignored offset: ${out.length} jobs, ${n} requests, truncated=${JSON.stringify(out.truncated)}`);
    if (warnings.length === 1 && /ignored \?offset=/.test(warnings[0]) && !/raise max_pages/.test(warnings[0])) pass('teamtailor.fetch() warns that the offset was ignored, not to raise max_pages');
    else fail(`ignored-offset warnings: ${JSON.stringify(warnings)}`);
  }

  {
    // Transient failure on page 2: retried through fetchTextWithRetry.
    let failures = 0;
    const out = await teamtailor.fetch(acme, mkCtx(async (url) => {
      const offset = offsetOf(url);
      if (offset === 100 && failures++ === 0) throw Object.assign(new Error('HTTP 503'), { status: 503 });
      return feedOf(offset, Math.max(0, Math.min(100, TOTAL - offset)));
    }));
    if (out.length === TOTAL && !out.truncated && failures === 2) pass('teamtailor.fetch() retries a transient page-2 failure and completes');
    else fail(`transient page 2: ${out.length} jobs, failures=${failures}, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    // Page 2 keeps failing: keep page 1, warn, mark fetch-error, no "raise max_pages".
    const { out, warnings } = await quietly(() => teamtailor.fetch(acme, mkCtx(async (url) => {
      if (url.includes('offset=')) throw new Error('HTTP 403 Forbidden');
      return feedOf(0, 100);
    })));
    if (out.length === 100 && out.truncated?.reason === 'fetch-error') pass('teamtailor.fetch() keeps earlier pages and marks fetch-error when a later page fails');
    else fail(`failing page 2: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
    if (warnings.length === 1 && !/raise max_pages/.test(warnings[0])) pass('teamtailor.fetch() fetch-error stop does not claim the ceiling truncated the board');
    else fail(`fetch-error warnings: ${JSON.stringify(warnings)}`);
  }

  {
    // The first page failing is a broken board: it throws.
    let threw = false;
    try { await teamtailor.fetch(acme, mkCtx(async () => { throw new Error('HTTP 403 Forbidden'); })); } catch { threw = true; }
    if (threw) pass('teamtailor.fetch() throws when the first page fails');
    else fail('teamtailor.fetch() swallowed a first-page failure');
  }

  {
    // A non-RSS body is read as an empty board, as before.
    const out = await teamtailor.fetch(acme, mkCtx(async () => '<html>not a feed</html>'));
    if (out.length === 0 && !out.truncated) pass('teamtailor.fetch() treats a non-RSS body as an empty board');
    else fail(`non-RSS body: ${out.length} jobs`);
  }

} catch (e) {
  fail(`teamtailor provider tests crashed: ${e.message}`);
}

