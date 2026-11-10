// tests/providers/tes.test.mjs — offline contract coverage for the Tes
// provider (#6685). Fictional schools and postings only, in the shape the
// live tRPC search endpoint returned on 2026-11-09.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — tes');

const PAGE_SIZE = 50;

/** One fictional row, as jobs.search returns it. */
function row(id, over = {}) {
  return {
    id,
    title: `Teacher of Mathematics ${id}`,
    promoted: false,
    shortDescription: 'Acme Academy seeks a teacher of mathematics.',
    displayLocation: 'Springfield, Exampleshire',
    displaySalary: '',
    contractTerms: ['Permanent'],
    contractTypes: ['Full Time'],
    canonicalUrl: `/jobs/vacancy/teacher-of-mathematics-springfield-${id}`,
    employer: { name: 'Acme Academy' },
    salary: { range: '£31,650 - £49,084 per year', description: '' },
    advert: { startDate: '2026-11-08T17:00:00.000Z', endDate: '2026-12-05T05:00:00.000Z' },
    application: { closeDate: '2026-12-05T05:00:00.000Z' },
    ...over,
  };
}

/** A tRPC batch response holding one page. */
function batch(jobs, totalPages = 1) {
  return [{ result: { data: { json: { numFound: jobs.length, jobs, sponsoredJobIds: [], currentPage: 1, totalPages } } } }];
}

const ids = (from, count) => Array.from({ length: count }, (_, i) => from + i);
const fullPage = (from, totalPages) => batch(ids(from, PAGE_SIZE).map((id) => row(id)), totalPages);

/**
 * A ctx whose fetchJson serves `pages` in order and records every call. A
 * trailing Error keeps being thrown, so a retried 503 or transport error is
 * one that retry cannot clear.
 */
function pagedCtx(pages, extra = {}) {
  const calls = [];
  const ctx = {
    sleeps: 0,
    sleep: async () => { ctx.sleeps++; },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const last = pages[pages.length - 1];
      const next = calls.length > pages.length && last instanceof Error ? last : pages[calls.length - 1];
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`unexpected request ${calls.length}: ${url}`);
      return next;
    },
    ...extra,
  };
  return { ctx, calls };
}

/** The decoded `input` of a recorded request. */
const inputOf = (url) => JSON.parse(new URL(url).searchParams.get('input'))['0'].json;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/tes.mjs')).href);
  const tes = mod.default;
  const entry = { name: 'Tes', provider: 'tes' };

  if (tes.id === 'tes') pass('tes.id is "tes"');
  else fail(`wrong provider id ${tes.id}`);

  // ── detect(): explicit-only ────────────────────────────────────────────────
  const hit = tes.detect({ name: 'Tes', provider: 'tes' });
  if (hit?.url === 'https://www.tes.com/jobs/') pass('detect() claims an entry with provider: tes and no careers_url');
  else fail(`detect(provider: tes) = ${JSON.stringify(hit)}`);
  let detectOk = true;
  for (const junk of [null, undefined, {}, { provider: 'jobicy' }, { careers_url: 'https://www.tes.com/jobs/' }, { provider: 42 }, 'tes']) {
    try {
      if (tes.detect(/** @type {any} */ (junk)) !== null) { detectOk = false; fail(`detect(${JSON.stringify(junk)}) should be null`); }
    } catch (e) { detectOk = false; fail(`detect(${JSON.stringify(junk)}) threw: ${e.message}`); }
  }
  if (detectOk) pass('detect() returns null, without throwing, for any other entry (a tes.com careers_url included)');

  // ── keywords ───────────────────────────────────────────────────────────────
  if (mod.tesKeywords({}) === '' && mod.tesKeywords({ keywords: '  maths ' }) === 'maths') pass('tesKeywords() trims, and is empty when unset');
  else fail('tesKeywords() trim/unset');
  let rejected = 0;
  for (const bad of [42, ['maths'], '   ', 'x'.repeat(101), 'maths\nphysics']) {
    try { mod.tesKeywords({ name: 'Tes', keywords: bad }); } catch (e) { if (/keywords in entry "Tes"/.test(e.message)) rejected++; }
  }
  if (rejected === 5) pass('tesKeywords() rejects a non-string, blank, oversized or multi-line value with a named error');
  else fail(`tesKeywords() rejected ${rejected} of 5 bad values`);

  // ── the request ────────────────────────────────────────────────────────────
  const input = inputOf(mod.buildTesSearchUrl('maths', 3));
  const f = input.filters;
  if (input.limit === 50 && input.siteCountry === 'gb' && f.keywords === 'maths' && f.page === 3 && f.sort === 'date'
      && Array.isArray(f.locations) && Array.isArray(f.excludedLocations)
      && ['contractTerms', 'contractTypes', 'subjects', 'workplaces', 'positions', 'location'].every((k) => k in f.filters)) {
    pass('buildTesSearchUrl() sends limit 50 (above 50 the endpoint returns no rows), sort date, the page, and every required filter key');
  } else fail(`request input: ${JSON.stringify(input)}`);
  const u = new URL(mod.buildTesSearchUrl('', 1));
  if (u.origin === 'https://www.tes.com' && u.pathname === '/jobs/api/trpc/jobs.search' && u.searchParams.get('batch') === '1') pass('buildTesSearchUrl() targets the fixed tRPC search path with batch=1');
  else fail(`request url: ${u.href}`);

  // ── parsing ────────────────────────────────────────────────────────────────
  const [job] = mod.parseTesJobs([row(7, { title: 'Head of Art &amp; Design', employer: { name: 'St Mary&#39;s School' } })], 'Tes');
  if (job.title === 'Head of Art & Design' && job.company === "St Mary's School"
      && job.url === 'https://www.tes.com/jobs/vacancy/teacher-of-mathematics-springfield-7'
      && job.location === 'Springfield, Exampleshire' && job.externalId === '7'
      && job.postedAt === Date.UTC(2026, 10, 8, 17) && job.closesAt === '2026-12-05'
      && job.description === 'Acme Academy seeks a teacher of mathematics.'
      && job.salary?.min === 31650 && job.salary?.max === 49084 && job.salary?.currency === 'GBP') {
    pass('parseTesJobs() normalizes title, company, url, location, id, posted date, close day, description and salary (entities decoded)');
  } else fail(`parsed job: ${JSON.stringify(job)}`);
  const [bare] = mod.parseTesJobs([row(8, { employer: null, salary: null, advert: { startDate: 'not a date' }, application: {}, shortDescription: null })], 'Tes');
  if (bare.company === 'Tes' && !('postedAt' in bare) && !('closesAt' in bare) && !('salary' in bare) && !('description' in bare)) {
    pass('parseTesJobs() falls back to the entry name and omits fields the row lacks (NaN-safe dates)');
  } else fail(`bare job: ${JSON.stringify(bare)}`);
  const kept = mod.parseTesJobs([
    row(1),
    row(2, { title: '   ' }),
    row(3, { canonicalUrl: 'https://evil.example/jobs/vacancy/x-3' }),
    row(4, { canonicalUrl: '//evil.example/jobs/vacancy/x-4' }),
    row(5, { canonicalUrl: '/jobs/vacancy/../../admin-5' }),
    row(6, { canonicalUrl: '/teaching-resource/x-6' }),
    row(9, { canonicalUrl: null }),
    null,
    'row',
  ], 'Tes');
  if (kept.length === 1 && kept[0].externalId === '1') pass('parseTesJobs() drops rows without a title or a Tes vacancy path (foreign, protocol-relative, traversal, other paths)');
  else fail(`kept ${JSON.stringify(kept.map((j) => j.url))}`);

  // ── salary ─────────────────────────────────────────────────────────────────
  const salaryCases = [
    ['£31,650 - £49,084 per year', { min: 31650, max: 49084, currency: 'GBP' }],
    ['£42,000 per year', { min: 42000, max: 42000, currency: 'GBP' }],
    ['AED 9,000 - AED 12,000 per year', { min: 9000, max: 12000, currency: 'AED' }],
    ['HK$30,000 - HK$40,000 per year', { min: 30000, max: 40000, currency: 'HKD' }],
    ['€40,000 - €50,000 per annum', { min: 40000, max: 50000, currency: 'EUR' }],
    ['$50,000 - $60,000 per year', undefined],
    ['£25 per hour', undefined],
    ['£30,000 - £35,000 pro rata', undefined],
    ['THB 50,000 - THB 80,000 per month', undefined],
    ['AED 9,000 - USD 12,000 per year', undefined],
    ['£49,084 - £31,650 per year', undefined],
    ['Competitive', undefined],
    [null, undefined],
  ];
  const badSalary = salaryCases.filter(([range, want]) => JSON.stringify(mod.tesSalary(range)) !== JSON.stringify(want));
  if (badSalary.length === 0) pass('tesSalary() reads one-currency annual figures (sign or ISO code) and leaves monthly, hourly, pro rata, bare-$ and mixed ranges off');
  else fail(`tesSalary() mismatches: ${JSON.stringify(badSalary.map(([r]) => [r, mod.tesSalary(r)]))}`);

  // ── empty vs broken ────────────────────────────────────────────────────────
  const empty = pagedCtx([batch([], 0)]);
  const emptyJobs = await tes.fetch(entry, empty.ctx);
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0 && emptyJobs.tesTruncated === undefined) pass('fetch() returns [] for a present-and-empty jobs array');
  else fail(`empty board: ${JSON.stringify(emptyJobs)}`);
  let broken = 0;
  for (const body of [{}, [], 'html', null, [{}], [{ result: { data: { json: { jobs: null } } } }], [{ result: { data: { json: { results: [] } } } }]]) {
    try { await tes.fetch(entry, pagedCtx([body]).ctx); } catch (e) { if (/^tes: unexpected search response/.test(e.message)) broken++; }
  }
  if (broken === 7) pass('fetch() throws a descriptive error for every response that is not the documented envelope');
  else fail(`fetch() threw on ${broken} of 7 broken envelopes`);
  try {
    await tes.fetch(entry, pagedCtx([[{ error: { json: { message: 'expected array at filters.excludedLocations', code: -32600 } } }]]).ctx);
    fail('fetch() should throw on a tRPC error entry');
  } catch (e) {
    if (/tes: the search endpoint returned an error: expected array at filters\.excludedLocations/.test(e.message)) pass('fetch() names the endpoint\'s own error message');
    else fail(`tRPC error entry: ${e.message}`);
  }
  const http400 = Object.assign(new Error('HTTP 400 Bad Request'), {
    status: 400,
    body: JSON.stringify([{ error: { json: { message: 'Too big: expected number to be <=100', code: -32600 } } }]),
  });
  try {
    await tes.fetch(entry, pagedCtx([http400]).ctx);
    fail('fetch() should throw on an HTTP 400 first page');
  } catch (e) {
    if (/Too big: expected number to be <=100 \(Tes\)/.test(e.message) && e.cause === http400) pass('fetch() turns a first-page HTTP 400 into the schema error Tes sent, keeping the cause');
    else fail(`HTTP 400: ${e.message}`);
  }

  // ── the walk ───────────────────────────────────────────────────────────────
  const walk = pagedCtx([fullPage(1, 3), fullPage(51, 3), batch([row(101), row(50) /* dup of page 1 */], 3)]);
  const { result: walked, errors: walkWarnings } = await captureConsoleErrors(() => tes.fetch(entry, walk.ctx));
  if (walked.length === 101 && walk.calls.length === 3 && walk.calls.map((c) => inputOf(c.url).filters.page).join() === '1,2,3') pass('fetch() walks pages in order to a short final page and dedups a row seen on an earlier page');
  else fail(`walk: ${walked.length} jobs over ${walk.calls.length} requests`);
  if (walk.calls.every((c) => c.opts?.redirect === 'error')) pass('fetch() passes redirect:"error" on every page request');
  else fail(`redirect opts: ${JSON.stringify(walk.calls.map((c) => c.opts))}`);
  if (walk.ctx.sleeps === 2) pass('fetch() paces pages past the first');
  else fail(`sleeps=${walk.ctx.sleeps}`);
  if (walkWarnings.length === 0 && walked.tesTruncated === undefined) pass('fetch() a complete walk warns nothing and is not tagged truncated');
  else fail(`complete walk: warnings=${JSON.stringify(walkWarnings)} truncated=${walked.tesTruncated}`);

  const exact = pagedCtx([fullPage(1, 2), fullPage(51, 2)]);
  const { result: exactJobs, errors: exactWarnings } = await captureConsoleErrors(() => tes.fetch({ ...entry, max_pages: 2 }, exact.ctx));
  if (exactJobs.length === 100 && exact.calls.length === 2 && exactWarnings.length === 0 && exactJobs.tesTruncated === undefined) {
    pass('fetch() a board whose reported last page is full ends there: complete, not capped');
  } else fail(`exact fit: ${exactJobs.length} jobs, warnings=${JSON.stringify(exactWarnings)}, truncated=${exactJobs.tesTruncated}`);

  const endless = pagedCtx(Array.from({ length: 3 }, (_, i) => fullPage(1 + i * PAGE_SIZE, 999)));
  const { result: capped, errors: capWarnings } = await captureConsoleErrors(() => tes.fetch({ ...entry, max_pages: 3 }, endless.ctx));
  if (endless.calls.length === 3 && capped.tesTruncated === true && capWarnings.some((w) => /truncated at max_pages=3 \(150 jobs\) — raise max_pages on this entry, or narrow it with keywords/.test(w))) {
    pass('fetch() stops at max_pages even when the board reports more, warns "raise max_pages", and tags tesTruncated');
  } else fail(`cap: ${endless.calls.length} requests, warnings=${JSON.stringify(capWarnings)}`);
  if (mod.resolveMaxPages({}) === 150 && mod.resolveMaxPages({ max_pages: 10 }) === 10 && mod.resolveMaxPages({ max_pages: 100000 }) === 400
      && mod.resolveMaxPages({ max_pages: -1 }) === 150 && mod.resolveMaxPages({ max_pages: '9' }) === 150) {
    pass('resolveMaxPages() defaults to 150, honours a positive integer, and caps at 400 whatever the board reports');
  } else fail('resolveMaxPages()');

  const midError = Object.assign(new Error('HTTP 503'), { status: 503 });
  const failing = pagedCtx([fullPage(1, 5), midError]);
  const { result: partial, errors: partialWarnings } = await captureConsoleErrors(() => tes.fetch(entry, failing.ctx));
  if (partial.length === 50 && partial.tesTruncated === true && partialWarnings.some((w) => /truncated at page 2 \(50 jobs kept\): HTTP 503/.test(w))
      && !partialWarnings.some((w) => /raise max_pages/.test(w))) {
    pass('fetch() keeps page 1 when page 2 fails, warns and tags truncated, and does not blame max_pages');
  } else fail(`page-2 failure: ${partial.length} jobs, warnings=${JSON.stringify(partialWarnings)}`);
  const odd = pagedCtx([fullPage(1, 5), { unexpected: true }]);
  const { result: oddJobs, errors: oddWarnings } = await captureConsoleErrors(() => tes.fetch(entry, odd.ctx));
  if (oddJobs.length === 50 && oddJobs.tesTruncated === true && oddWarnings.some((w) => /truncated at page 2 .*unexpected search response/.test(w))) {
    pass('fetch() keeps the pages read when a later page is not the documented envelope');
  } else fail(`unrecognised page 2: ${oddJobs.length} jobs, warnings=${JSON.stringify(oddWarnings)}`);

  // ── the health probe (verify-portals, ctx.maxPages: 1) ─────────────────────
  const probe = pagedCtx([fullPage(1, 114), fullPage(51, 114)], { maxPages: 1 });
  const { result: probed, errors: probeWarnings } = await captureConsoleErrors(() => tes.fetch(entry, probe.ctx));
  if (probe.calls.length === 1 && probed.length === 50 && probe.ctx.sleeps === 0 && probeWarnings.length === 0 && probed.tesTruncated === undefined) {
    pass('fetch() makes exactly one list request under ctx.maxPages: 1, with no cap warning');
  } else fail(`probe: ${probe.calls.length} requests, ${probed.length} jobs, warnings=${JSON.stringify(probeWarnings)}`);
  class BudgetReached extends Error {}
  const budget = new BudgetReached('probe budget reached');
  try {
    await tes.fetch(entry, pagedCtx([budget], { maxPages: 1 }).ctx);
    fail('a probe rejection was swallowed');
  } catch (e) {
    if (e === budget) pass('fetch() propagates a ctx.fetchJson rejection unwrapped while probing');
    else fail(`probe rejection was rewrapped: ${e.message}`);
  }

  // ── keywords reach the request ─────────────────────────────────────────────
  const narrowed = pagedCtx([batch([row(1)], 1)]);
  await tes.fetch({ ...entry, keywords: 'maths' }, narrowed.ctx);
  if (inputOf(narrowed.calls[0].url).filters.keywords === 'maths') pass('fetch() sends the entry keywords to the search');
  else fail('keywords not sent');
  let configCalls = 0;
  try {
    await tes.fetch({ ...entry, keywords: 'a\nb' }, { fetchJson: async () => { configCalls++; return batch([]); } });
    fail('a malformed keywords value should throw');
  } catch (e) {
    if (configCalls === 0) pass('fetch() rejects a malformed keywords value before any request');
    else fail(`malformed keywords issued ${configCalls} requests`);
  }
} catch (e) { fail(`tes provider tests crashed: ${e.stack || e.message}`); }
