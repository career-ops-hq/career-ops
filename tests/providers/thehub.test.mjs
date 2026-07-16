// tests/providers/thehub.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — thehub');

try {
  const thehubModule = await import(pathToFileURL(join(ROOT, 'providers/thehub.mjs')).href);
  const thehub = thehubModule.default;
  const { normalizeHubJob } = thehubModule;

  if (thehub.id === 'thehub') pass('thehub.id is "thehub"');
  else fail(`thehub.id is ${JSON.stringify(thehub.id)}`);

  // normalizeHubJob — full mapping.
  const full = normalizeHubJob(
    { title: '  Staff Engineer  ', absoluteJobUrl: 'https://thehub.io/jobs/abc123', company: { name: '  Light  ' }, location: { address: '  London, UK  ' }, publishedAt: '2026-06-02T06:59:54.025Z' },
    'Fallback',
  );
  if (full && full.title === 'Staff Engineer' && full.url === 'https://thehub.io/jobs/abc123'
      && full.company === 'Light' && full.location === 'London, UK'
      && full.postedAt === Date.parse('2026-06-02T06:59:54.025Z')) {
    pass('normalizeHubJob maps title/absoluteJobUrl/company.name/location.address + publishedAt → postedAt');
  } else {
    fail(`normalizeHubJob full row = ${JSON.stringify(full)}`);
  }

  // location assembled from locality/country, "Remote" appended when isRemote.
  const assembled = normalizeHubJob({ title: 'R', absoluteJobUrl: 'https://thehub.io/jobs/r', location: { locality: 'Berlin', country: 'Germany' }, isRemote: true }, 'X');
  if (assembled?.location === 'Berlin, Germany, Remote') pass('normalizeHubJob assembles locality/country and appends "Remote" when isRemote');
  else fail(`normalizeHubJob assembled location = ${JSON.stringify(assembled?.location)}`);

  // company fallbacks: entry name, then "The Hub".
  const coEntry = normalizeHubJob({ title: 'T', absoluteJobUrl: 'https://thehub.io/jobs/c1', company: {} }, 'Entry Name');
  const coDefault = normalizeHubJob({ title: 'T', absoluteJobUrl: 'https://thehub.io/jobs/c2' });
  const coBlank = normalizeHubJob({ title: 'T', absoluteJobUrl: 'https://thehub.io/jobs/c3' }, '   '); // whitespace-only → "The Hub"
  if (coEntry?.company === 'Entry Name' && coDefault?.company === 'The Hub' && coBlank?.company === 'The Hub') {
    pass('normalizeHubJob falls back company → entry name → "The Hub" (whitespace-only entry name ignored)');
  } else {
    fail(`normalizeHubJob company fallbacks = ${JSON.stringify({ a: coEntry?.company, b: coDefault?.company, c: coBlank?.company })}`);
  }

  // postedAt falls back to createdAt; omitted when both absent.
  const fromCreated = normalizeHubJob({ title: 'T', absoluteJobUrl: 'https://thehub.io/jobs/cd', createdAt: '2026-06-01T00:00:00.000Z' });
  const noDate = normalizeHubJob({ title: 'T', absoluteJobUrl: 'https://thehub.io/jobs/nd' });
  if (fromCreated?.postedAt === Date.parse('2026-06-01T00:00:00.000Z') && noDate && !('postedAt' in noDate)) {
    pass('normalizeHubJob falls back to createdAt and omits postedAt when both dates are absent');
  } else {
    fail(`normalizeHubJob date handling = ${JSON.stringify({ created: fromCreated?.postedAt, none: noDate })}`);
  }

  // host-lock + drops: off-host url, non-https url, missing url, empty title, non-object.
  const drops = [
    normalizeHubJob({ title: 'Off host', absoluteJobUrl: 'https://evil.example/jobs/x' }),
    normalizeHubJob({ title: 'Insecure', absoluteJobUrl: 'http://thehub.io/jobs/x' }),
    normalizeHubJob({ title: 'No URL' }),
    normalizeHubJob({ title: '', absoluteJobUrl: 'https://thehub.io/jobs/x' }),
    normalizeHubJob(null),
  ];
  if (drops.every(r => r === null)) {
    pass('normalizeHubJob host-locks absoluteJobUrl to thehub.io and drops off-host/non-https/no-url/empty-title/non-object');
  } else {
    fail(`normalizeHubJob drops = ${JSON.stringify(drops)}`);
  }

  // fetch(): pagination by ?page=N, stop on a short page.
  const mk = (i) => ({ title: `Role ${i}`, absoluteJobUrl: `https://thehub.io/jobs/x${i}`, company: { name: `Co ${i}` }, location: { address: 'Copenhagen, Denmark' }, publishedAt: '2026-06-02T00:00:00.000Z' });
  const hubPage1 = { docs: Array.from({ length: 15 }, (_, i) => mk(i)), page: 1, pages: 3, total: 33, limit: 15 };
  const hubPage2 = { docs: [mk(15), mk(16), { title: '', absoluteJobUrl: 'https://thehub.io/jobs/bad' }], page: 2, pages: 3, limit: 15 }; // short → stop; 1 drop
  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const page = Number(new URL(url).searchParams.get('page'));
    return page === 1 ? hubPage1 : hubPage2;
  };
  const paged = await thehub.fetch({ name: 'The Hub' }, { fetchJson: pagedFetch });

  if (requested.length === 2
      && requested[0].url === 'https://thehub.io/api/jobs?page=1'
      && requested[1].url === 'https://thehub.io/api/jobs?page=2') {
    pass('thehub.fetch() builds ?page=N URLs and stops after the short page');
  } else {
    fail(`thehub.fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('thehub.fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`thehub.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  if (paged.length === 17) pass('thehub.fetch() aggregates valid jobs across pages (15 + 2, dropping the empty-title row)');
  else fail(`thehub.fetch() returned ${paged.length} jobs (expected 17)`);

  // Stops at the reported total pages even when every page is full.
  const fullReq = [];
  const fullPage = (page) => ({ docs: Array.from({ length: 15 }, (_, i) => mk(page * 100 + i)), page, pages: 2, limit: 15 });
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
    { fetchJson: async (url) => { capReq.push(url); return { docs: Array.from({ length: 15 }, (_, i) => mk(i)), page: 1, pages: 67, limit: 15 }; } },
  );
  if (capReq.length === 1 && capReq[0] === 'https://thehub.io/api/jobs?page=1') {
    pass('thehub.fetch() honors max_pages (stops at the cap even on a full page)');
  } else {
    fail(`thehub.fetch() max_pages:1 requested ${JSON.stringify(capReq)}`);
  }

  // A full page with a large `pages` (so neither short-stop nor pages-stop fires)
  // lets us assert the implicit default cap and the hard cap purely on page count.
  const fullDeepPage = (page) => ({ docs: Array.from({ length: 15 }, (_, i) => mk(page * 100 + i)), page, pages: 999, limit: 15 });

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
  else fail('thehub.fetch() should throw when the docs array is absent');

} catch (e) {
  fail(`thehub provider tests crashed: ${e.message}`);
}
