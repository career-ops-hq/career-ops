// tests/providers/staffam.test.mjs — staff.am board-wide __NEXT_DATA__ provider.
//
// Fixtures reproduce the shape measured on the live board on 2026-10-02:
// `props.pageProps.jobs` holds 50 postings per page plus one interleaved
// banner row (`itemType: 0`, no id), text fields are per-language objects
// that arrive HTML-escaped (sometimes twice), and a page past the end answers
// with `jobs: []`.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — staffam (staff.am __NEXT_DATA__)');

const BANNER = { itemType: 0, image: 'https://cdn.example/b.jpg', link: 'https://staff.am/en/banner/1' };

let nextId = 1000;
function row(over = {}) {
  const id = nextId++;
  return {
    itemType: 1,
    id,
    title: { en: `Engineer ${id}`, am: 'Ինժեներ', ru: 'Инженер', am_en: 'Ingener' },
    slug: { en: `engineer-${id}`, am: `ingener-${id}`, ru: `inzhener-${id}` },
    category: { code: 'software-development', id: 1, title: { en: 'Software development' } },
    companiesStruct: { id: 1, slug: 'acme', title: { en: 'Acme', am: 'Ակմե', ru: 'Акме' } },
    job_city: { title: { en: 'Yerevan', am: 'Երևան', ru: 'Ереван' } },
    is_remote: false,
    activated_at: { staffam: '2026-10-02 07:00:32' },
    ...over,
  };
}

const page = (jobs, totalCount = jobs.length) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    page: '/jobs',
    props: { pageProps: { jobs, totalCount, categoryFilters: {} } },
  })}</script></body></html>`;

/** ctx stub: answers each URL from `pages` (a function or a map), records calls. */
function stubCtx(answer, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      sleep: async () => {},
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        return answer(url, calls.length);
      },
      ...extra,
    },
  };
}

const withQuietStderr = async (fn) => {
  const orig = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: await fn(), lines }; } finally { console.error = orig; }
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/staffam.mjs')).href);
  const staffam = mod.default;
  const { buildListUrl, resolveCategories, extractNextData, toEpochMs, normalizeRow, parseListingPage } = mod;

  if (staffam.id === 'staffam') pass('staffam.id is "staffam"');
  else fail(`staffam.id is ${JSON.stringify(staffam.id)}`);

  // ── detect(): explicit-only (board-wide aggregator) ──
  const hit = staffam.detect({ name: 'staff.am', provider: 'staffam' });
  if (hit && hit.url === 'https://staff.am/en/jobs') pass('detect() resolves provider:staffam → the listing URL, no careers_url needed');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  const misses = [
    { name: 'x' },
    { name: 'x', careers_url: 'https://staff.am/en/jobs' },
    { name: 'x', careers_url: 'https://staff.am/company/acme' },
    { name: 'x', provider: 'itviec' },
    null,
    undefined,
  ];
  if (misses.every((e) => staffam.detect(e) === null)) pass('detect() returns null without provider:staffam (never claims a staff.am URL on its own)');
  else fail('detect() must require provider:staffam');

  // ── URL shapes: only the two robots.txt allows ──
  if (buildListUrl(null, 1) === 'https://staff.am/en/jobs'
      && buildListUrl(null, 3) === 'https://staff.am/en/jobs?page=3'
      && buildListUrl('software-development', 1) === 'https://staff.am/en/jobs/software-development'
      && buildListUrl('software-development', 2) === 'https://staff.am/en/jobs/software-development?page=2') {
    pass('buildListUrl(): path + optional category segment, ?page=N only past page 1');
  } else {
    fail(`buildListUrl drift: ${buildListUrl(null, 1)} / ${buildListUrl('software-development', 2)}`);
  }

  // ── resolveCategories ──
  const rc = resolveCategories({ categories: [' Software-Development ', 'ai', 'ai'] });
  if (JSON.stringify(rc) === '["software-development","ai"]' && resolveCategories({}) === null
      && JSON.stringify(resolveCategories({ categories: 'ai' })) === '["ai"]') {
    pass('resolveCategories(): normalizes, de-dupes, accepts a scalar, null when absent');
  } else {
    fail(`resolveCategories wrong: ${JSON.stringify(rc)}`);
  }
  let threw = false;
  try { resolveCategories({ categories: ['../admin'] }); } catch { threw = true; }
  let threw2 = false;
  try { resolveCategories({ categories: ['a?x=1'] }); } catch { threw2 = true; }
  if (threw && threw2) pass('resolveCategories(): a path-traversal / query-smuggling value throws as a config error');
  else fail('resolveCategories() must reject non-slug categories');

  // ── extractNextData ──
  if (extractNextData('<html>none</html>') === null && extractNextData(undefined) === null
      && extractNextData('<script id="__NEXT_DATA__">nope</script>') === null) {
    pass('extractNextData(): null on missing script, non-string input, malformed JSON');
  } else {
    fail('extractNextData() should return null on junk');
  }

  // ── toEpochMs: Yerevan wall clock, NaN-safe ──
  if (toEpochMs('2026-10-02 07:00:32') === Date.parse('2026-10-02T03:00:32Z')
      && toEpochMs('garbage') === undefined && toEpochMs('') === undefined && toEpochMs(null) === undefined) {
    pass('toEpochMs(): reads "YYYY-MM-DD HH:MM:SS" as UTC+4, undefined on junk');
  } else {
    fail(`toEpochMs wrong: ${toEpochMs('2026-10-02 07:00:32')}`);
  }

  // ── normalizeRow ──
  const n = normalizeRow(row({
    id: 7,
    title: { en: 'Google Cloud &amp;amp; AI Platform Engineer', am: '' },
    slug: { en: 'gcp-engineer' },
    is_remote: true,
    job_city: { title: { en: 'San Diego' } },
    companiesStruct: { title: { en: 'Acme &amp; Sons ' } },
  }));
  if (n && n.title === 'Google Cloud & AI Platform Engineer' && n.company === 'Acme & Sons'
      && n.url === 'https://staff.am/en/jobs/software-development/gcp-engineer'
      && n.location === 'San Diego (Remote)' && typeof n.postedAt === 'number') {
    pass('normalizeRow(): double-escaped entities decoded, URL from category+slug, remote flag in location');
  } else {
    fail(`normalizeRow wrong: ${JSON.stringify(n)}`);
  }
  const fallback = normalizeRow(row({ title: { en: '', am_en: 'Hashvapah', am: 'Հաշվապահ' }, job_city: undefined, is_remote: true }));
  if (fallback?.title === 'Hashvapah' && fallback.location === 'Remote') pass('normalizeRow(): falls back past an empty English title; remote with no city → "Remote"');
  else fail(`normalizeRow fallback wrong: ${JSON.stringify(fallback)}`);
  const noDate = normalizeRow(row({ activated_at: {} }));
  if (noDate && !('postedAt' in noDate)) pass('normalizeRow(): omits postedAt when the row carries no date');
  else fail(`normalizeRow should omit postedAt: ${JSON.stringify(noDate)}`);
  if ([BANNER, row({ title: {} }), row({ slug: {} }), row({ category: null }), row({ id: undefined }), null, 'x']
    .map(normalizeRow).every((r) => r === null)) {
    pass('normalizeRow(): banner rows and rows missing title/slug/category/id → null');
  } else {
    fail('normalizeRow() should drop banners and malformed rows');
  }

  // ── empty vs broken ──
  const empty = parseListingPage(page([], 0), 'u');
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('parseListingPage(): present-and-empty jobs[] → no jobs, no throw');
  else fail('parseListingPage() empty case wrong');
  const broken = [
    ['no __NEXT_DATA__', '<html><body>redesigned</body></html>'],
    ['jobs missing', `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { listings: [] } } })}</script>`],
    ['jobs wrong type', `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { jobs: {} } } })}</script>`],
    ['no pageProps', `<script id="__NEXT_DATA__">${JSON.stringify({ props: {} })}</script>`],
  ];
  const brokenOk = broken.every(([, html]) => {
    try { parseListingPage(html, 'u'); return false; } catch (e) { return /staffam:/.test(e.message); }
  });
  if (brokenOk) pass('parseListingPage(): missing blob / missing or wrong-typed jobs → descriptive throw');
  else fail('parseListingPage() must throw on an undocumented shape');
  let keysMsg = '';
  try { parseListingPage(broken[1][1], 'u'); } catch (e) { keysMsg = e.message; }
  if (keysMsg.includes('listings')) pass('parseListingPage(): the throw names the keys it did get');
  else fail(`throw should name keys: ${keysMsg}`);

  // ── fetch(): single short page ──
  {
    const { ctx, calls } = stubCtx(() => page([row(), BANNER, row({ title: {} }), row()]));
    const jobs = await staffam.fetch({ name: 'staff.am', provider: 'staffam' }, ctx);
    if (jobs.length === 2 && calls.length === 1 && calls[0].url === 'https://staff.am/en/jobs'
        && jobs.every((j) => j.company === 'Acme' && j.location === 'Yerevan' && !('id' in j))) {
      pass('fetch(): a short first page ends the walk; banner + malformed row dropped; internal id not leaked');
    } else {
      fail(`fetch() single page wrong: ${JSON.stringify(jobs)} after ${calls.length} calls`);
    }
    if (calls.every((c) => c.opts?.redirect === 'error')) pass('fetch(): every request passes redirect:"error"');
    else fail('fetch() must pass redirect:"error" on every request');
  }

  // ── fetch(): pagination, featured duplicate de-dupe, total-count stop ──
  {
    const p1 = Array.from({ length: 50 }, () => row());
    // Page 2 repeats a page-1 posting (staff.am re-lists featured jobs), and is full.
    const p2 = [p1[0], ...Array.from({ length: 49 }, () => row())];
    const p3 = Array.from({ length: 50 }, () => row());
    const { ctx, calls } = stubCtx((url) => {
      if (url.endsWith('?page=2')) return page([BANNER, ...p2], 150);
      if (url.endsWith('?page=3')) return page(p3, 150);
      return page([BANNER, ...p1], 150);
    });
    const jobs = await staffam.fetch({ name: 'staff.am', provider: 'staffam' }, ctx);
    if (calls.length === 3 && jobs.length === 149) {
      pass('fetch(): walks ?page=N, stops at totalCount, de-dupes a repeated posting by id');
    } else {
      fail(`pagination wrong: ${jobs.length} jobs, ${calls.length} calls`);
    }
  }

  // ── fetch(): a page full of malformed rows still counts as full (raw count) ──
  {
    const bad = Array.from({ length: 50 }, () => row({ title: {} }));
    const { ctx, calls } = stubCtx((url) => (url.endsWith('?page=2') ? page([row()], 51) : page(bad, 51)));
    const jobs = await staffam.fetch({ name: 'staff.am', provider: 'staffam' }, ctx);
    if (calls.length === 2 && jobs.length === 1) pass('fetch(): short-page stop uses the source row count, not the filtered count');
    else fail(`raw-count stop wrong: ${calls.length} calls, ${jobs.length} jobs`);
  }

  // ── fetch(): own page ceiling, warning only on a real cap ──
  {
    const { ctx, calls } = stubCtx(() => page(Array.from({ length: 50 }, () => row()), 999_999));
    const { result: jobs, lines } = await withQuietStderr(() => staffam.fetch({ name: 'staff.am', provider: 'staffam' }, ctx));
    if (calls.length === 40 && jobs.length === 2000 && lines.some((l) => /raise max_pages/.test(l))) {
      pass('fetch(): DEFAULT_MAX_PAGES (40) stops an endless board despite the reported total, and warns');
    } else {
      fail(`default cap wrong: ${calls.length} calls, warnings ${JSON.stringify(lines)}`);
    }
  }
  {
    const { ctx, calls } = stubCtx(() => page(Array.from({ length: 50 }, () => row()), 999_999));
    await withQuietStderr(() => staffam.fetch({ name: 'x', provider: 'staffam', max_pages: 100_000 }, ctx));
    if (calls.length === 100) pass('fetch(): max_pages override is clamped to MAX_PAGES_CAP (100)');
    else fail(`MAX_PAGES_CAP wrong: ${calls.length} calls`);
  }
  {
    // Exactly 2 full pages and max_pages: 2 → total says complete, no warning.
    const { ctx } = stubCtx(() => page(Array.from({ length: 50 }, () => row()), 100));
    const { lines } = await withQuietStderr(() => staffam.fetch({ name: 'x', provider: 'staffam', max_pages: 2 }, ctx));
    if (!lines.some((l) => /raise max_pages/.test(l))) pass('fetch(): no truncation warning when the board ends exactly at the cap');
    else fail('fetch() warned on a complete board');
  }

  // ── fetch(): probe cooperation ──
  {
    const { ctx, calls } = stubCtx(() => page(Array.from({ length: 50 }, () => row()), 999), { maxPages: 1 });
    const { lines } = await withQuietStderr(() => staffam.fetch({ name: 'x', provider: 'staffam', categories: ['ai', 'software-development'] }, ctx));
    if (calls.length === 1 && !lines.some((l) => /raise max_pages/.test(l))) pass('fetch(): ctx.maxPages:1 → exactly one list request, even with several categories, no cap warning');
    else fail(`probe wrong: ${calls.length} calls`);
  }
  {
    class ProbePageBudgetReached extends Error {}
    const sentinel = new ProbePageBudgetReached('budget');
    const { ctx } = stubCtx((url, n) => { if (n > 1) throw sentinel; return page(Array.from({ length: 50 }, () => row()), 999); }, { maxPages: 2 });
    let got;
    try { await staffam.fetch({ name: 'x', provider: 'staffam' }, ctx); } catch (e) { got = e; }
    if (got === sentinel) pass('fetch(): a fetch rejection while probing propagates unwrapped');
    else fail(`probe rejection was wrapped/swallowed: ${got}`);
  }

  // ── fetch(): transient failure on page 2 keeps page 1, no cap warning ──
  {
    const err = Object.assign(new Error('HTTP 503'), { status: 503 });
    const { ctx } = stubCtx((url) => { if (url.endsWith('?page=2')) throw err; return page(Array.from({ length: 50 }, () => row()), 500); });
    const { result: jobs, lines } = await withQuietStderr(() => staffam.fetch({ name: 'x', provider: 'staffam' }, ctx));
    if (jobs.length === 50 && lines.some((l) => /stopped at page 2/.test(l)) && !lines.some((l) => /raise max_pages/.test(l))) {
      pass('fetch(): page-2 failure after retries keeps page 1 and warns — not the max_pages warning');
    } else {
      fail(`page-2 failure wrong: ${jobs?.length} jobs, ${JSON.stringify(lines)}`);
    }
  }
  {
    const err = Object.assign(new Error('HTTP 503'), { status: 503 });
    const { ctx } = stubCtx(() => { throw err; });
    let got;
    try { await staffam.fetch({ name: 'x', provider: 'staffam' }, ctx); } catch (e) { got = e; }
    if (got === err) pass('fetch(): a failing first page throws (a dead board is not an empty one)');
    else fail(`first-page failure should throw: ${got}`);
  }

  // ── fetch(): categories ──
  {
    const shared = row();
    const { ctx, calls } = stubCtx((url) => {
      if (url.includes('/nope')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
      if (url.includes('/ai')) return page([shared, row()]);
      return page([shared, row()]);
    });
    const { result: jobs, lines } = await withQuietStderr(() =>
      staffam.fetch({ name: 'x', provider: 'staffam', categories: ['software-development', 'nope', 'ai'] }, ctx));
    const urls = calls.map((c) => c.url);
    if (jobs.length === 3 && urls.includes('https://staff.am/en/jobs/software-development')
        && urls.includes('https://staff.am/en/jobs/ai') && lines.some((l) => /"nope" does not exist/.test(l))) {
      pass('fetch(): walks each category path, de-dupes across them, skips an unknown (404) category loudly');
    } else {
      fail(`categories wrong: ${jobs.length} jobs, ${JSON.stringify(urls)}, ${JSON.stringify(lines)}`);
    }
  }
  {
    const { ctx } = stubCtx(() => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); });
    let got;
    await withQuietStderr(async () => {
      try { await staffam.fetch({ name: 'x', provider: 'staffam', categories: ['nope'] }, ctx); } catch (e) { got = e; }
    });
    if (got && /none of the configured categories/.test(got.message)) pass('fetch(): every category 404ing throws instead of returning []');
    else fail(`all-404 should throw: ${got}`);
  }

  // ── fetch(): markup change throws, past-the-end empty returns [] ──
  {
    const { ctx } = stubCtx(() => '<html><body>new design</body></html>');
    let got;
    try { await staffam.fetch({ name: 'x', provider: 'staffam' }, ctx); } catch (e) { got = e; }
    if (got && /__NEXT_DATA__/.test(got.message)) pass('fetch(): a page with no __NEXT_DATA__ throws');
    else fail(`markup change should throw: ${got}`);
    const { ctx: ctx2 } = stubCtx(() => page([], 0));
    const jobs = await staffam.fetch({ name: 'x', provider: 'staffam' }, ctx2);
    if (Array.isArray(jobs) && jobs.length === 0) pass('fetch(): an empty board → []');
    else fail('empty board should return []');
  }
} catch (e) {
  fail(`staffam tests crashed: ${e.stack || e.message}`);
}
