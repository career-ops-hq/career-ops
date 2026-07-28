// tests/providers/a16z-speedrun-talent.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — a16z-speedrun-talent');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/a16z-speedrun-talent.mjs')).href);
  const provider = mod.default;
  const { normalizeSpeedrunJob } = mod;

  if (provider.id === 'a16z-speedrun-talent') pass('a16z-speedrun-talent.id is "a16z-speedrun-talent"');
  else fail(`a16z-speedrun-talent.id is ${JSON.stringify(provider.id)}`);

  // normalizeSpeedrunJob — full mapping.
  const full = normalizeSpeedrunJob(
    { title: '  Founding Engineer  ', url: 'https://speedrun-talent-network.com/jobs/founding-engineer-light-abc123', company: '  Light  ', location: '  New York, NY  ', remote: false, published_at: '2026-07-01T12:00:00.000Z' },
    'Fallback',
  );
  if (full && full.title === 'Founding Engineer'
      && full.url === 'https://speedrun-talent-network.com/jobs/founding-engineer-light-abc123'
      && full.company === 'Light' && full.location === 'New York, NY'
      && full.postedAt === Date.parse('2026-07-01T12:00:00.000Z')) {
    pass('normalizeSpeedrunJob maps title/url/company/location + published_at → postedAt');
  } else {
    fail(`normalizeSpeedrunJob full row = ${JSON.stringify(full)}`);
  }

  // "Remote" appended when remote is true; location may be null.
  const remoteLoc = normalizeSpeedrunJob({ title: 'R', url: 'https://speedrun-talent-network.com/jobs/r', location: 'SF Bay Area', remote: true });
  const remoteOnly = normalizeSpeedrunJob({ title: 'R', url: 'https://speedrun-talent-network.com/jobs/r2', location: null, remote: true });
  if (remoteLoc?.location === 'SF Bay Area, Remote' && remoteOnly?.location === 'Remote') {
    pass('normalizeSpeedrunJob appends "Remote" when remote and handles null location');
  } else {
    fail(`normalizeSpeedrunJob remote locations = ${JSON.stringify({ a: remoteLoc?.location, b: remoteOnly?.location })}`);
  }

  // company fallbacks: entry name, then "a16z speedrun talent network".
  const coEntry = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/c1', company: '' }, 'Entry Name');
  const coDefault = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/c2' });
  const coBlank = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/c3' }, '   ');
  if (coEntry?.company === 'Entry Name' && coDefault?.company === 'a16z speedrun talent network' && coBlank?.company === 'a16z speedrun talent network') {
    pass('normalizeSpeedrunJob falls back company → entry name → "a16z speedrun talent network"');
  } else {
    fail(`normalizeSpeedrunJob company fallbacks = ${JSON.stringify({ a: coEntry?.company, b: coDefault?.company, c: coBlank?.company })}`);
  }

  // postedAt omitted when published_at absent/unparseable.
  const noDate = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/nd', published_at: null });
  const badDate = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/bd', published_at: 'not-a-date' });
  if (noDate && !('postedAt' in noDate) && badDate && !('postedAt' in badDate)) {
    pass('normalizeSpeedrunJob omits postedAt when published_at is absent or unparseable');
  } else {
    fail(`normalizeSpeedrunJob date handling = ${JSON.stringify({ noDate, badDate })}`);
  }

  // host-lock + drops: off-host url, non-https url, missing url, empty title, non-object.
  const drops = [
    normalizeSpeedrunJob({ title: 'Off host', url: 'https://evil.example/jobs/x' }),
    normalizeSpeedrunJob({ title: 'Insecure', url: 'http://speedrun-talent-network.com/jobs/x' }),
    normalizeSpeedrunJob({ title: 'No URL' }),
    normalizeSpeedrunJob({ title: '', url: 'https://speedrun-talent-network.com/jobs/x' }),
    normalizeSpeedrunJob(null),
  ];
  if (drops.every((r) => r === null)) {
    pass('normalizeSpeedrunJob host-locks url to speedrun-talent-network.com and drops off-host/non-https/no-url/empty-title/non-object');
  } else {
    fail(`normalizeSpeedrunJob drops = ${JSON.stringify(drops)}`);
  }

  // detect(): claims careers_url / api on the trusted host, ignores others.
  const hit = provider.detect({ careers_url: 'https://speedrun-talent-network.com/jobs' });
  const hitApi = provider.detect({ api: 'https://speedrun-talent-network.com/api/v1/jobs' });
  const missHost = provider.detect({ careers_url: 'https://jobs.example.com' });
  const missNone = provider.detect({ name: 'no urls' });
  if (hit?.url && hitApi?.url && missHost === null && missNone === null) {
    pass('detect() claims speedrun-talent-network.com careers_url/api and ignores other hosts');
  } else {
    fail(`detect() = ${JSON.stringify({ hit, hitApi, missHost, missNone })}`);
  }

  // fetch(): 0-based pagination with source tag, stop on short page; q passthrough.
  const mk = (i) => ({ title: `Role ${i}`, url: `https://speedrun-talent-network.com/jobs/x${i}`, company: `Co ${i}`, location: 'New York, NY', remote: false, published_at: '2026-07-01T00:00:00.000Z' });
  const page0 = { jobs: Array.from({ length: 100 }, (_, i) => mk(i)), total: 133, page: 0, page_size: 100, total_pages: 2 };
  const page1 = { jobs: [mk(100), mk(101), { title: '', url: 'https://speedrun-talent-network.com/jobs/bad' }], total: 133, page: 1, page_size: 100, total_pages: 2 };
  const calls = [];
  const ctx = {
    fetchJson: async (url) => {
      calls.push(url);
      const page = new URL(url).searchParams.get('page');
      return page === '0' ? page0 : page1;
    },
  };
  const jobs = await provider.fetch({ name: 'a16z speedrun talent network', max_pages: 5, q: 'engineer' }, ctx);
  const urlsOk = calls.length === 2
    && calls.every((u) => u.startsWith('https://speedrun-talent-network.com/api/v1/jobs?'))
    && calls.every((u) => new URL(u).searchParams.get('source') === 'career-ops')
    && calls.every((u) => new URL(u).searchParams.get('q') === 'engineer')
    && new URL(calls[0]).searchParams.get('page') === '0'
    && new URL(calls[1]).searchParams.get('page') === '1';
  if (urlsOk && jobs.length === 102 && jobs[0].title === 'Role 0' && jobs[101].title === 'Role 101') {
    pass('fetch() paginates 0-based with source=career-ops + q passthrough, stops after total_pages, drops invalid rows');
  } else {
    fail(`fetch() = ${JSON.stringify({ calls, count: jobs.length })}`);
  }

  // fetch(): max_pages caps ahead of total_pages.
  const capCalls = [];
  const capCtx = { fetchJson: async (url) => { capCalls.push(url); return { jobs: Array.from({ length: 100 }, (_, i) => mk(i)), total_pages: 50 }; } };
  const capped = await provider.fetch({ max_pages: 2 }, capCtx);
  if (capCalls.length === 2 && capped.length === 200) pass('fetch() honors max_pages ahead of total_pages');
  else fail(`fetch() cap = ${JSON.stringify({ calls: capCalls.length, jobs: capped.length })}`);

  // resolveQuery: keywords[] fallback when q: is absent.
  const kwCalls = [];
  const kwCtx = { fetchJson: async (url) => { kwCalls.push(url); return { jobs: [mk(0)], total_pages: 1 }; } };
  await provider.fetch({ keywords: ['machine', '', 'learning'] }, kwCtx);
  if (new URL(kwCalls[0]).searchParams.get('q') === 'machine learning') pass('fetch() falls back to joined keywords[] when q: is absent');
  else fail(`keywords fallback q = ${JSON.stringify(new URL(kwCalls[0]).searchParams.get('q'))}`);

  // MAX_PAGES_CAP: an oversized max_pages is clamped to 120, and the
  // truncation warning fires (spied via console.error, restored in finally).
  const bigCalls = [];
  const bigCtx = { fetchJson: async (url) => { bigCalls.push(url); return { jobs: Array.from({ length: 100 }, (_, i) => mk(i)), total_pages: 500 }; } };
  const warnings = [];
  const realConsoleError = console.error;
  try {
    console.error = (...args) => warnings.push(args.join(' '));
    await provider.fetch({ max_pages: 9999 }, bigCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (bigCalls.length === 120) pass('fetch() clamps max_pages to the 120-page cap');
  else fail(`cap clamp fetched ${bigCalls.length} pages`);
  if (warnings.some((w) => w.includes('truncated at max_pages=120'))) pass('fetch() warns when the cap truncates the feed');
  else fail(`cap warning missing; captured = ${JSON.stringify(warnings)}`);

  // fetch(): malformed payload throws with a useful message.
  let threw = false;
  try {
    await provider.fetch({}, { fetchJson: async () => ({ nope: true }) });
  } catch (e) {
    threw = /unexpected API response/.test(String(e?.message));
  }
  if (threw) pass('fetch() throws on a payload without jobs[]');
  else fail('fetch() did not throw on malformed payload');
} catch (e) {
  fail(`a16z-speedrun-talent provider test crashed: ${e?.stack || e}`);
}
