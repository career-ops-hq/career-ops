// tests/providers/paylocity.test.mjs — providers/paylocity.mjs (board page with inline window.pageData).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — paylocity');

const GUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const BOARD = `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`;

/** A board page in the shape Paylocity serves: the list sits in one inline script. */
function page(pageData) {
  return `<html><head></head><body>
  <script>
    window.ATSJobDetailsBaseUrl = '/Recruiting/Jobs/Details/';
  </script>
  <script>
    window.pageData = ${JSON.stringify(pageData)};
  </script>
</body></html>`;
}

const SAMPLE = {
  ModuleTitle: 'ExampleCo Holdings',
  Jobs: [
    {
      JobId: 4001, JobTitle: 'QA Engineer', LocationName: 'Frankfurt, Germany', ShouldDisplayLocation: true,
      PublishedDate: '2026-10-20T12:15:47-05:00', IsInternal: false, IsRemote: false,
      JobLocation: { City: null, State: null, Country: 'USA' },
    },
    {
      JobId: '4002', JobTitle: 'R&D Lead', LocationName: '', ShouldDisplayLocation: true,
      PublishedDate: 'not a date', IsInternal: false, IsRemote: true, IndeedRemoteType: 2,
      JobLocation: { City: 'Austin', State: 'TX', Country: 'USA' },
    },
    {
      JobId: 4003, JobTitle: 'Hidden Location Role', LocationName: 'Secret Site', ShouldDisplayLocation: false,
      IsInternal: false, IsRemote: false, JobLocation: { City: 'X', State: 'Y' },
    },
    { JobId: 4004, JobTitle: 'Internal Transfer', LocationName: 'HQ', IsInternal: true },
    { JobId: 4005, JobTitle: '   ', LocationName: 'HQ' },
    { JobTitle: 'No Id', LocationName: 'HQ' },
    null,
  ],
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/paylocity.mjs')).href);
  const paylocity = mod.default;
  const { parsePaylocityBoard, resolveBoardUrl, boardUrl } = mod;

  if (paylocity.id === 'paylocity') pass('paylocity.id is "paylocity"');
  else fail(`paylocity.id is ${JSON.stringify(paylocity.id)}`);

  // ── detect() ──
  const detectCases = [
    ['canonical board URL', BOARD],
    ['lower-case path', `https://recruiting.paylocity.com/recruiting/jobs/all/${GUID}`],
    ['trailing company slug', `${BOARD}/ExampleCo`],
    ['query string', `${BOARD}?department=All`],
    ['upper-case GUID', `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID.toUpperCase()}`],
  ];
  for (const [label, url] of detectCases) {
    const hit = paylocity.detect({ name: 'ExampleCo', careers_url: url });
    if (hit?.url === BOARD) pass(`paylocity.detect() claims a ${label} and rebuilds the canonical board URL`);
    else fail(`paylocity.detect() ${label} returned ${JSON.stringify(hit)}`);
  }

  const apiHit = paylocity.detect({ name: 'ExampleCo', careers_url: 'https://exampleco.com/careers', api: BOARD });
  if (apiHit?.url === BOARD) pass('paylocity.detect() honours an explicit api: URL');
  else fail(`paylocity.detect() api: returned ${JSON.stringify(apiHit)}`);

  const rejected = [
    ['untrusted host', `https://evil.example/Recruiting/Jobs/All/${GUID}`],
    ['host in the path', `https://evil.example/recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`],
    ['look-alike host suffix', `https://recruiting.paylocity.com.evil.example/Recruiting/Jobs/All/${GUID}`],
    ['non-HTTPS', `http://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`],
    ['malformed URL', 'not a url'],
    ['non-GUID board id', 'https://recruiting.paylocity.com/Recruiting/Jobs/All/not-a-guid'],
    ['posting detail URL (no board id)', 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/4001'],
    ['null careers_url', null],
    ['non-string careers_url', 7],
    ['missing careers_url', undefined],
  ];
  for (const [label, url] of rejected) {
    let hit;
    try {
      hit = paylocity.detect({ name: 'X', careers_url: url });
    } catch (e) {
      fail(`paylocity.detect() threw on ${label}: ${e.message}`);
      continue;
    }
    if (hit === null) pass(`paylocity.detect() returns null for ${label}`);
    else fail(`paylocity.detect() should return null for ${label}, got ${JSON.stringify(hit)}`);
  }

  if (resolveBoardUrl(null) === null) pass('resolveBoardUrl(null) returns null');
  else fail('resolveBoardUrl(null) should return null');

  // boardUrl() — the one GUID check, shared with scan-ats-full.mjs.
  if (boardUrl(` ${GUID.toUpperCase()} `) === BOARD) pass('boardUrl() trims and lower-cases a GUID into the canonical board URL');
  else fail(`boardUrl() returned ${JSON.stringify(boardUrl(` ${GUID.toUpperCase()} `))}`);
  for (const [label, value] of [
    ['a non-GUID string', 'not-a-guid'],
    ['a GUID with a path suffix', `${GUID}/../../evil`],
    ['a number', 42],
    ['undefined', undefined],
  ]) {
    if (boardUrl(value) === null) pass(`boardUrl() returns null for ${label}`);
    else fail(`boardUrl() should return null for ${label}, got ${JSON.stringify(boardUrl(value))}`);
  }

  // ── parsePaylocityBoard() ──
  const jobs = parsePaylocityBoard(page(SAMPLE), 'ExampleCo');
  if (jobs.length === 3) pass('parsePaylocityBoard keeps the 3 public rows, drops internal, blank-title, id-less and null rows');
  else fail(`parsePaylocityBoard returned ${jobs.length} jobs: ${JSON.stringify(jobs.map(j => j.title))}`);

  const [qa, rd, hidden] = jobs;
  if (qa?.url === 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/4001' && qa.company === 'ExampleCo') {
    pass('parsePaylocityBoard builds the /Recruiting/Jobs/Details/<JobId> URL and uses entry.name as company');
  } else {
    fail(`parsePaylocityBoard first job was ${JSON.stringify(qa)}`);
  }
  if (qa?.location === 'Frankfurt, Germany') pass('parsePaylocityBoard uses LocationName and ignores JobLocation.Country');
  else fail(`parsePaylocityBoard location was ${JSON.stringify(qa?.location)}`);
  if (qa?.postedAt === Date.parse('2026-10-20T12:15:47-05:00')) pass('parsePaylocityBoard maps PublishedDate to postedAt');
  else fail(`parsePaylocityBoard postedAt was ${qa?.postedAt}`);

  if (rd?.title === 'R&D Lead') pass('parsePaylocityBoard keeps a literal & in the title');
  else fail(`parsePaylocityBoard title was ${JSON.stringify(rd?.title)}`);
  if (rd?.location === 'Austin, TX, Remote') pass('parsePaylocityBoard falls back to City/State and appends Remote');
  else fail(`parsePaylocityBoard fallback location was ${JSON.stringify(rd?.location)}`);
  if (rd && !('postedAt' in rd)) pass('parsePaylocityBoard omits postedAt for an unparseable PublishedDate');
  else fail(`parsePaylocityBoard should omit postedAt, got ${rd?.postedAt}`);
  if (rd?.url === 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/4002') pass('parsePaylocityBoard accepts a string JobId');
  else fail(`parsePaylocityBoard string-id url was ${rd?.url}`);

  if (hidden?.location === '') pass('parsePaylocityBoard leaves location empty when ShouldDisplayLocation is false');
  else fail(`parsePaylocityBoard hidden location was ${JSON.stringify(hidden?.location)}`);

  // Work-mode label, the way the board page derives it from IsRemote + IndeedRemoteType.
  {
    const row = (id, extra) => ({ JobId: id, JobTitle: `Role ${id}`, LocationName: 'Denver, CO', ShouldDisplayLocation: true, ...extra });
    const cases = [
      ['IndeedRemoteType 2 (fully remote)', { IsRemote: true, IndeedRemoteType: 2 }, 'Denver, CO, Remote'],
      ['IndeedRemoteType 1 (hybrid)', { IsRemote: true, IndeedRemoteType: 1 }, 'Denver, CO, Hybrid'],
      ['IndeedRemoteType 0 (temporary work from home)', { IsRemote: true, IndeedRemoteType: 0 }, 'Denver, CO, Remote'],
      ['IsRemote without IndeedRemoteType', { IsRemote: true }, 'Denver, CO'],
      ['IsRemote with an unknown IndeedRemoteType', { IsRemote: true, IndeedRemoteType: 7 }, 'Denver, CO'],
      ['IsRemote with an IndeedRemoteType naming an Object.prototype key', { IsRemote: true, IndeedRemoteType: 'constructor' }, 'Denver, CO'],
      ['IndeedRemoteType without IsRemote', { IsRemote: false, IndeedRemoteType: 2 }, 'Denver, CO'],
      ['a hidden location on a fully remote posting', { IsRemote: true, IndeedRemoteType: 2, ShouldDisplayLocation: false }, 'Remote'],
    ];
    const parsed = parsePaylocityBoard(page({ Jobs: cases.map(([, extra], i) => row(5000 + i, extra)) }), 'ExampleCo');
    cases.forEach(([label, , expected], i) => {
      if (parsed[i]?.location === expected) pass(`parsePaylocityBoard location for ${label} is ${JSON.stringify(expected)}`);
      else fail(`parsePaylocityBoard location for ${label} was ${JSON.stringify(parsed[i]?.location)}, expected ${JSON.stringify(expected)}`);
    });
  }

  if (jobs.every(j => !('description' in j))) pass('parsePaylocityBoard does not emit the truncated description snippet');
  else fail('parsePaylocityBoard should not emit description');

  const fromTitle = parsePaylocityBoard(page(SAMPLE), '');
  if (fromTitle[0]?.company === 'ExampleCo Holdings') pass('parsePaylocityBoard falls back to ModuleTitle when entry.name is empty');
  else fail(`parsePaylocityBoard company fallback was ${JSON.stringify(fromTitle[0]?.company)}`);

  // Empty board vs broken page.
  const empty = parsePaylocityBoard(page({ ModuleTitle: 'ExampleCo', Jobs: [] }), 'ExampleCo');
  if (Array.isArray(empty) && empty.length === 0) pass('parsePaylocityBoard returns [] for a board with Jobs: []');
  else fail(`parsePaylocityBoard empty board returned ${JSON.stringify(empty)}`);

  const brokenCases = [
    ['a page with no pageData script', '<html><body><p>Maintenance</p></body></html>', /window\.pageData not found/],
    ['pageData that is not valid JSON', '<script>window.pageData = {Jobs: [oops]};</script>', /window\.pageData not found/],
    ['pageData without Jobs', page({ ModuleTitle: 'ExampleCo', Openings: [] }), /expected Jobs\[\], got: \[ModuleTitle, Openings\]/],
    ['pageData with a non-array Jobs', page({ Jobs: {} }), /expected Jobs\[\]/],
    ['an empty body', '', /window\.pageData not found/],
    ['a non-string body', 42, /window\.pageData not found/],
  ];
  for (const [label, html, re] of brokenCases) {
    try {
      parsePaylocityBoard(html, 'ExampleCo');
      fail(`parsePaylocityBoard should throw on ${label}`);
    } catch (e) {
      if (re.test(e.message)) pass(`parsePaylocityBoard throws a descriptive error on ${label}`);
      else fail(`parsePaylocityBoard error on ${label} was "${e.message}"`);
    }
  }

  // ── fetch() ──
  {
    const calls = [];
    const ctx = { fetchText: async (url, opts) => { calls.push({ url, opts }); return page(SAMPLE); } };
    const fetched = await paylocity.fetch({ name: 'ExampleCo', careers_url: `${BOARD}/ExampleCo?x=1` }, ctx);
    if (calls.length === 1 && calls[0].url === BOARD && fetched.length === 3) {
      pass('paylocity.fetch() issues one request to the canonical board URL and returns parsed jobs');
    } else {
      fail(`paylocity.fetch() calls=${JSON.stringify(calls.map(c => c.url))} jobs=${fetched.length}`);
    }
    if (calls.every(c => c.opts?.redirect === 'manual')) pass('paylocity.fetch() requests with redirect:manual (never followed)');
    else fail(`paylocity.fetch() redirect opts were ${JSON.stringify(calls.map(c => c.opts))}`);
    if (calls.every(c => c.opts?.timeoutMs > 10_000)) pass('paylocity.fetch() raises the timeout for large single-page boards');
    else fail(`paylocity.fetch() timeoutMs was ${JSON.stringify(calls.map(c => c.opts?.timeoutMs))}`);
  }

  // SSRF guard: an untrusted host never reaches ctx.fetchText.
  {
    let calls = 0;
    const ctx = { fetchText: async () => { calls++; throw new Error('should never be called'); } };
    try {
      await paylocity.fetch({ name: 'Evil', careers_url: `https://evil.example/Recruiting/Jobs/All/${GUID}` }, ctx);
      fail('paylocity.fetch() should throw for an untrusted host');
    } catch {
      if (calls === 0) pass('paylocity.fetch() rejects an untrusted host before any fetchText call');
      else fail(`paylocity.fetch() called fetchText ${calls} time(s) for an untrusted host`);
    }
  }

  // A redirect to JobNotFound is a dead board: synthetic 404 for dead-boards.mjs,
  // after exactly one request (a redirect is not retried).
  for (const location of ['/Recruiting/Jobs/JobNotFound', 'https://recruiting.paylocity.com/Recruiting/Jobs/JobNotFound']) {
    let calls = 0;
    const ctx = {
      sleep: async () => {},
      fetchText: async () => {
        calls++;
        const err = new Error('HTTP 302 Found');
        err.status = 302;
        err.location = location;
        throw err;
      },
    };
    try {
      await paylocity.fetch({ name: 'ExampleCo', careers_url: BOARD }, ctx);
      fail('paylocity.fetch() should throw on a JobNotFound redirect');
    } catch (e) {
      if (e.status === 404 && /no such board/.test(e.message) && calls === 1) {
        pass(`paylocity.fetch() maps a 302 to ${location} to a 404 without retrying`);
      } else {
        fail(`paylocity.fetch() JobNotFound redirect gave status=${e.status} "${e.message}" after ${calls} call(s)`);
      }
    }
  }

  // A 429 is retried, and the board comes back once the throttle clears.
  {
    const calls = [];
    const sleeps = [];
    const ctx = {
      sleep: async (ms) => { sleeps.push(ms); },
      fetchText: async (url, opts) => {
        calls.push(opts);
        if (calls.length < 3) {
          const err = new Error('HTTP 429 Too Many Requests');
          err.status = 429;
          err.retryAfter = calls.length === 1 ? '5' : null;
          throw err;
        }
        return page(SAMPLE);
      },
    };
    const jobs = await paylocity.fetch({ name: 'ExampleCo', careers_url: BOARD }, ctx);
    if (jobs.length === 3 && calls.length === 3) pass('paylocity.fetch() retries a 429 and returns the board once it answers');
    else fail(`paylocity.fetch() after 429s: ${jobs.length} jobs, ${calls.length} calls`);
    if (sleeps[0] === 5_000) pass('paylocity.fetch() waits for the Retry-After a 429 carries');
    else fail(`paylocity.fetch() first wait was ${sleeps[0]} ms, expected 5000`);
    if (calls.every(o => o?.redirect === 'manual')) pass('paylocity.fetch() passes redirect:manual on every attempt');
    else fail(`paylocity.fetch() retry redirect opts were ${JSON.stringify(calls.map(o => o?.redirect))}`);
  }

  // A throttle that never clears ends in the 429 itself, not in a dead-board 404.
  {
    let calls = 0;
    const throttled = new Error('HTTP 429 Too Many Requests');
    throttled.status = 429;
    const ctx = { sleep: async () => {}, fetchText: async () => { calls++; throw throttled; } };
    try {
      await paylocity.fetch({ name: 'ExampleCo', careers_url: BOARD }, ctx);
      fail('paylocity.fetch() should throw when every attempt is throttled');
    } catch (e) {
      if (e === throttled && e.status === 429 && calls === 4) pass('paylocity.fetch() gives up after 4 throttled attempts and rethrows the 429');
      else fail(`paylocity.fetch() persistent 429 gave status=${e.status} after ${calls} call(s)`);
    }
  }

  // Any other redirect, and any other HTTP error, propagates unchanged.
  for (const [label, status, location] of [
    ['a redirect elsewhere', 302, 'https://www.paylocity.com/'],
    ['a server error', 503, null],
  ]) {
    const original = new Error(`HTTP ${status}`);
    original.status = status;
    original.location = location;
    const ctx = { sleep: async () => {}, fetchText: async () => { throw original; } };
    try {
      await paylocity.fetch({ name: 'ExampleCo', careers_url: BOARD }, ctx);
      fail(`paylocity.fetch() should throw on ${label}`);
    } catch (e) {
      if (e === original) pass(`paylocity.fetch() rethrows ${label} unchanged`);
      else fail(`paylocity.fetch() ${label} gave status=${e.status} "${e.message}"`);
    }
  }
} catch (e) {
  fail(`paylocity provider tests crashed: ${e.stack || e.message}`);
}
