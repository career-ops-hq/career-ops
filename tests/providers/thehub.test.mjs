// tests/providers/thehub.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — thehub');

try {
  const thehubModule = await import(pathToFileURL(join(ROOT, 'providers/thehub.mjs')).href);
  const thehub = thehubModule.default;
  const { normalizeHubJob, parseThehubConfig } = thehubModule;

  if (thehub.id === 'thehub') pass('thehub.id is "thehub"');
  else fail(`thehub.id is ${JSON.stringify(thehub.id)}`);

  // parseThehubConfig: defaults to EU/no-remote, honors overrides, ignores blank/non-string/non-true.
  const cfgDefault = parseThehubConfig({});
  const cfgOverride = parseThehubConfig({ thehub: { countryCode: 'DK', includeRemote: true } });
  const cfgBlank = parseThehubConfig({ thehub: { countryCode: '   ', includeRemote: 'true' } });
  if (cfgDefault.countryCode === 'EU' && cfgDefault.includeRemote === false
      && cfgOverride.countryCode === 'DK' && cfgOverride.includeRemote === true
      && cfgBlank.countryCode === 'EU' && cfgBlank.includeRemote === false) {
    pass('parseThehubConfig defaults countryCode/includeRemote and honors portals.yml overrides (strict boolean true)');
  } else {
    fail(`parseThehubConfig = ${JSON.stringify({ cfgDefault, cfgOverride, cfgBlank })}`);
  }

  // normalizeHubJob — full mapping.
  const full = normalizeHubJob(
    { title: '  Staff Engineer  ', id: 'abc123', company: { name: '  Acme Corp  ' }, location: { address: '  London, UK  ' } },
    'Fallback',
  );
  if (full && full.title === 'Staff Engineer' && full.url === 'https://thehub.io/jobs/abc123'
      && full.company === 'Acme Corp' && full.location === 'London, UK') {
    pass('normalizeHubJob maps title/id/company.name/location.address');
  } else {
    fail(`normalizeHubJob full row = ${JSON.stringify(full)}`);
  }

  // location assembled from locality/country, "Remote" appended when isRemote.
  const assembled = normalizeHubJob({ title: 'R', id: 'r', location: { locality: 'Berlin', country: 'Germany' }, isRemote: true }, 'X');
  if (assembled?.location === 'Berlin, Germany, Remote') pass('normalizeHubJob assembles locality/country and appends "Remote" when isRemote');
  else fail(`normalizeHubJob assembled location = ${JSON.stringify(assembled?.location)}`);

  // The remote pass returns some jobs with no `location` key at all (observed live,
  // e.g. freelance postings) — must resolve to just "Remote", not throw or leave a
  // stray comma.
  const noLocRemote = normalizeHubJob({ title: 'R', id: 'nlr', isRemote: true });
  const noLocOnsite = normalizeHubJob({ title: 'R', id: 'nlo' });
  if (noLocRemote?.location === 'Remote' && noLocOnsite?.location === '') {
    pass('normalizeHubJob resolves a missing location to "Remote" (isRemote) or "" (not remote), never throwing');
  } else {
    fail(`normalizeHubJob missing-location results = ${JSON.stringify({ remote: noLocRemote?.location, onsite: noLocOnsite?.location })}`);
  }

  // company fallbacks: entry name, then "The Hub".
  const coEntry = normalizeHubJob({ title: 'T', id: 'c1', company: {} }, 'Entry Name');
  const coDefault = normalizeHubJob({ title: 'T', id: 'c2' });
  const coBlank = normalizeHubJob({ title: 'T', id: 'c3' }, '   '); // whitespace-only → "The Hub"
  if (coEntry?.company === 'Entry Name' && coDefault?.company === 'The Hub' && coBlank?.company === 'The Hub') {
    pass('normalizeHubJob falls back company → entry name → "The Hub" (whitespace-only entry name ignored)');
  } else {
    fail(`normalizeHubJob company fallbacks = ${JSON.stringify({ a: coEntry?.company, b: coDefault?.company, c: coBlank?.company })}`);
  }

  // id-based URL construction: always thehub.io, encoded, missing/empty id or title drops the row.
  const drops = [
    normalizeHubJob({ title: 'No id' }),
    normalizeHubJob({ title: '', id: 'x' }),
    normalizeHubJob({ title: '  ', id: 'x' }),
    normalizeHubJob({ id: 'x' }),
    normalizeHubJob(null),
  ];
  if (drops.every(r => r === null)) {
    pass('normalizeHubJob drops rows missing id or title (or non-object input)');
  } else {
    fail(`normalizeHubJob drops = ${JSON.stringify(drops)}`);
  }

  const encoded = normalizeHubJob({ title: 'Weird id', id: 'a/b c' });
  if (encoded?.url === 'https://thehub.io/jobs/a%2Fb%20c') pass('normalizeHubJob URL-encodes the id');
  else fail(`normalizeHubJob encoded url = ${JSON.stringify(encoded?.url)}`);

  // fetch(): pagination by ?page=N&countryCode=EU, stop on a short page.
  const mk = (i) => ({ title: `Role ${i}`, id: `x${i}`, company: { name: `Co ${i}` }, location: { address: 'Copenhagen, Denmark' } });
  const hubPage1 = { jobs: { docs: Array.from({ length: 15 }, (_, i) => mk(i)), page: 1, pages: 3, total: 33, limit: 15 } };
  const hubPage2 = { jobs: { docs: [mk(15), mk(16), { title: '', id: 'bad' }], page: 2, pages: 3, limit: 15 } }; // short → stop; 1 drop
  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const page = Number(new URL(url).searchParams.get('page'));
    return page === 1 ? hubPage1 : hubPage2;
  };
  const paged = await thehub.fetch({ name: 'The Hub' }, { fetchJson: pagedFetch });

  if (requested.length === 2
      && requested[0].url === 'https://thehub.io/api/v2/jobsandfeatured?page=1&countryCode=EU'
      && requested[1].url === 'https://thehub.io/api/v2/jobsandfeatured?page=2&countryCode=EU') {
    pass('thehub.fetch() builds ?page=N&countryCode=EU URLs and stops after the short page');
  } else {
    fail(`thehub.fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('thehub.fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`thehub.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  // portals.yml `thehub.countryCode` override flows into the request URL.
  const dkReq = [];
  await thehub.fetch(
    { name: 'The Hub', thehub: { countryCode: 'DK' } },
    { fetchJson: async (url) => { dkReq.push(url); return { jobs: { docs: [], page: 1, pages: 1, limit: 15 } }; } },
  );
  if (dkReq[0] === 'https://thehub.io/api/v2/jobsandfeatured?page=1&countryCode=DK') {
    pass('thehub.fetch() honors a portals.yml countryCode override');
  } else {
    fail(`thehub.fetch() countryCode override requested = ${JSON.stringify(dkReq)}`);
  }

  // includeRemote: false (default) never queries isRemote=true.
  const noRemoteReq = [];
  await thehub.fetch(
    { name: 'The Hub' },
    { fetchJson: async (url) => { noRemoteReq.push(url); return { jobs: { docs: [], page: 1, pages: 1, limit: 15 } }; } },
  );
  if (noRemoteReq.length === 1 && !noRemoteReq[0].includes('isRemote')) {
    pass('thehub.fetch() skips the remote pass when includeRemote is not set');
  } else {
    fail(`thehub.fetch() default requested = ${JSON.stringify(noRemoteReq)}`);
  }

  // includeRemote: true runs a second isRemote=true pass and merges/dedups by url with the region pass.
  const remoteReq = [];
  const regionDocs = { jobs: { docs: [mk('r1'), mk('shared')], page: 1, pages: 1, limit: 15 } };
  const remoteDocs = { jobs: { docs: [mk('shared'), mk('r2')], page: 1, pages: 1, limit: 15 } }; // 'shared' overlaps the region pass
  const withRemote = await thehub.fetch(
    { name: 'The Hub', thehub: { includeRemote: true } },
    { fetchJson: async (url) => { remoteReq.push(url); return url.includes('isRemote=true') ? remoteDocs : regionDocs; } },
  );
  if (remoteReq.length === 2
      && remoteReq[0] === 'https://thehub.io/api/v2/jobsandfeatured?page=1&countryCode=EU'
      && remoteReq[1] === 'https://thehub.io/api/v2/jobsandfeatured?page=1&isRemote=true'
      && withRemote.length === 3) {
    pass('thehub.fetch() runs an isRemote=true pass after the region pass when includeRemote is set, deduping by url');
  } else {
    fail(`thehub.fetch() includeRemote requested = ${JSON.stringify(remoteReq)}, returned ${withRemote.length} jobs (expected 3)`);
  }

  if (paged.length === 17) pass('thehub.fetch() aggregates valid jobs across pages (15 + 2, dropping the empty-title row)');
  else fail(`thehub.fetch() returned ${paged.length} jobs (expected 17)`);

  // Stops at the reported total pages even when every page is full.
  const fullReq = [];
  const fullPage = (page) => ({ jobs: { docs: Array.from({ length: 15 }, (_, i) => mk(page * 100 + i)), page, pages: 2, limit: 15 } });
  await thehub.fetch(
    { name: 'The Hub', max_pages: 10 },
    { fetchJson: async (url) => { const p = Number(new URL(url).searchParams.get('page')); fullReq.push(p); return fullPage(p); } },
  );
  if (fullReq.length === 2 && fullReq[0] === 1 && fullReq[1] === 2) {
    pass('thehub.fetch() stops at the reported total pages (pages:2) even with a higher max_pages');
  } else {
    fail(`thehub.fetch() pages-stop requested ${JSON.stringify(fullReq)}`);
  }

  // max_pages cap: only the first page is requested.
  const capReq = [];
  await thehub.fetch(
    { name: 'The Hub', max_pages: 1 },
    { fetchJson: async (url) => { capReq.push(url); return { jobs: { docs: Array.from({ length: 15 }, (_, i) => mk(i)), page: 1, pages: 67, limit: 15 } }; } },
  );
  if (capReq.length === 1 && capReq[0] === 'https://thehub.io/api/v2/jobsandfeatured?page=1&countryCode=EU') {
    pass('thehub.fetch() honors max_pages (stops at the cap even on a full page)');
  } else {
    fail(`thehub.fetch() max_pages:1 requested ${JSON.stringify(capReq)}`);
  }

  // A full page with a large `pages` (so neither short-stop nor pages-stop fires)
  // lets us assert the implicit default cap and the hard cap purely on page count.
  const fullDeepPage = (page) => ({ jobs: { docs: Array.from({ length: 15 }, (_, i) => mk(page * 100 + i)), page, pages: 999, limit: 15 } });

  // Default max_pages (no override) → exactly 3 pages.
  const defReq = [];
  await thehub.fetch(
    { name: 'The Hub' },
    { fetchJson: async (url) => { defReq.push(Number(new URL(url).searchParams.get('page'))); return fullDeepPage(defReq.length); } },
  );
  if (defReq.length === 3 && defReq[0] === 1 && defReq[2] === 3) {
    pass('thehub.fetch() defaults to 3 pages when max_pages is not set');
  } else {
    fail(`thehub.fetch() default-cap requested ${JSON.stringify(defReq)} (expected pages 1..3)`);
  }

  // max_pages above the hard cap → clamped to 67 pages.
  const cap67Req = [];
  await thehub.fetch(
    { name: 'The Hub', max_pages: 1000 },
    { fetchJson: async (url) => { cap67Req.push(Number(new URL(url).searchParams.get('page'))); return fullDeepPage(cap67Req.length); } },
  );
  if (cap67Req.length === 67 && cap67Req[0] === 1 && cap67Req[66] === 67) {
    pass('thehub.fetch() clamps max_pages to the hard cap of 67');
  } else {
    fail(`thehub.fetch() hard-cap requested ${cap67Req.length} pages (expected 67)`);
  }

  // unexpected API response → throws.
  let badThrew = false;
  try {
    await thehub.fetch({ name: 'X' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (e) {
    badThrew = /unexpected API response/.test(e.message);
  }
  if (badThrew) pass('thehub.fetch() throws on unexpected API response shape');
  else fail('thehub.fetch() should throw when jobs.docs is absent');

  // #2379 contract: a dead board (first request fails) must still surface as
  // a failure — no try/catch may swallow it.
  let firstFailThrew = false;
  try {
    await thehub.fetch({ name: 'The Hub' }, { fetchJson: async () => { throw new Error('HTTP 500'); } });
  } catch { firstFailThrew = true; }
  if (firstFailThrew) {
    pass('thehub.fetch() still throws when the very first request fails (dead board reads as failure)');
  } else {
    fail('thehub.fetch() swallowed a first-request failure');
  }

  // A later page failing mid-pagination (after page 1 already succeeded)
  // must keep what's already collected instead of discarding it.
  const blipReq = [];
  const blipJobs = await thehub.fetch(
    { name: 'The Hub' },
    {
      fetchJson: async (url) => {
        blipReq.push(url);
        const page = Number(new URL(url).searchParams.get('page'));
        if (page === 1) return { jobs: { docs: Array.from({ length: 15 }, (_, i) => mk(i)), page: 1, pages: 3, limit: 15 } };
        throw new Error('HTTP 503');
      },
    },
  );
  if (blipReq.length === 2 && blipJobs.length === 15) {
    pass('thehub.fetch() keeps already-collected region-pass jobs when a later page fails');
  } else {
    fail(`thehub.fetch() region-pass partial failure: requested ${blipReq.length}, returned ${blipJobs.length} jobs (expected 2 requests, 15 jobs)`);
  }

  // The remote pass failing after the region pass already succeeded must not
  // discard the region-pass results (the "one bad pass shouldn't sink the
  // other" case Scott-Emberson flagged on PR #2524).
  const remoteFailReq = [];
  const remoteFailJobs = await thehub.fetch(
    { name: 'The Hub', thehub: { includeRemote: true } },
    {
      fetchJson: async (url) => {
        remoteFailReq.push(url);
        if (url.includes('isRemote=true')) throw new Error('HTTP 500');
        return { jobs: { docs: [mk('region-only')], page: 1, pages: 1, limit: 15 } };
      },
    },
  );
  if (remoteFailReq.length === 2 && remoteFailJobs.length === 1) {
    pass('thehub.fetch() keeps region-pass jobs when the remote pass fails after the region pass already succeeded');
  } else {
    fail(`thehub.fetch() remote-pass failure: requested ${remoteFailReq.length}, returned ${remoteFailJobs.length} jobs (expected 2 requests, 1 job)`);
  }

} catch (e) {
  fail(`thehub provider tests crashed: ${e.message}`);
}
