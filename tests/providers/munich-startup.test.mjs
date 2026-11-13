// tests/providers/munich-startup.test.mjs — provider-contract tests for the
// Munich Startup job pinboard (providers/munich-startup.mjs): the listing JSON
// inside Next.js RSC chunks, relative-date parsing, pagination and probe
// cooperation.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — munich-startup');

const LIST = 'https://www.munich-startup.de/jobs';

function ad(id, over = {}) {
  return {
    id,
    type: 'AdJob',
    status: 'active',
    imported: false,
    title: `Engineer ${id} (m/w/d)`,
    excerpt: 'Deine Aufgaben ...',
    created_label: 'vor 2 Wochen',
    runs_until_label: 'noch 30 Tage',
    company: { name: 'ExampleCo GmbH', logo: 'https://example.com/logo.png' },
    pills: ['Vollzeit'],
    meta: { employment: 'Vollzeit' },
    ...over,
  };
}

/**
 * A /jobs page as Next.js serves it: the RSC text split across two
 * `self.__next_f.push([1,"…"])` scripts, cutting through the listing JSON.
 */
function page(listing) {
  const flight = `5:["$","$L17","stellenangebote",{"listing":${JSON.stringify(listing)},"category":{"id":1}}]\n`;
  const cut = Math.floor(flight.length / 2);
  return [
    '<html><body><a href="/jobs/anzeige/1">x</a>',
    `<script>self.__next_f.push(${JSON.stringify([1, flight.slice(0, cut)])})</script>`,
    `<script>self.__next_f.push(${JSON.stringify([1, flight.slice(cut)])})</script>`,
    '</body></html>',
  ].join('');
}
const listing = (data, current, last, perPage = 3, total = 5) => ({ data, meta: { current_page: current, last_page: last, per_page: perPage, total } });

function makeCtx(pages, { maxPages } = {}) {
  const calls = [];
  const ctx = {
    calls,
    sleep: async () => {},
    async fetchText(url, opts = {}) {
      calls.push({ url, opts });
      const body = pages[url];
      if (body instanceof Error) throw body;
      if (body === undefined) throw Object.assign(new Error(`HTTP 404 ${url}`), { status: 404 });
      return body;
    },
    async fetchJson() { throw new Error('fetchJson not used'); },
  };
  if (maxPages) ctx.maxPages = maxPages;
  return ctx;
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/munich-startup.mjs')).href);
  const provider = mod.default;
  const { parseListing, relativeLabelToEpochMs, toJob } = mod;

  if (provider.id === 'munich-startup') pass('id is "munich-startup"');
  else fail(`id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', provider: 'munich-startup' });
  if (hit?.url === LIST) pass('detect() resolves provider: munich-startup with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (provider.detect({ name: 'X', careers_url: 'https://www.munich-startup.de/jobs' }) === null
    && provider.detect(null) === null && provider.detect({}) === null) {
    pass('detect() is explicit-only and never throws on junk');
  } else fail('detect() should be explicit-only');

  // parseListing
  const parsed = parseListing(page(listing([ad(1), ad(2)], 1, 2)));
  if (parsed.data.length === 2 && parsed.lastPage === 2 && parsed.perPage === 3 && parsed.total === 5) {
    pass('parseListing reassembles the RSC chunks and reads data[] + meta');
  } else fail(`parseListing returned ${JSON.stringify(parsed)}`);
  if (parseListing(page(listing([], 1, 1, 15, 0))).data.length === 0) pass('parseListing: present-and-empty data[] → empty board');
  else fail('empty data[] should parse to an empty list');
  for (const [label, html] of [
    ['a page without the listing JSON', '<html><a href="/jobs/anzeige/5">x</a><script>self.__next_f.push([1,"0:{}"])</script></html>'],
    ['a listing without data[]', page({ items: [] })],
    ['a non-string body', null],
    ['an empty body', ''],
  ]) {
    try {
      parseListing(html);
      fail(`parseListing should throw on ${label}`);
    } catch (e) {
      if (/munich-startup/.test(e.message)) pass(`parseListing throws a descriptive error on ${label}`);
      else fail(`parseListing threw an undescriptive error on ${label}: ${e.message}`);
    }
  }

  // relativeLabelToEpochMs
  const now = Date.UTC(2026, 9, 28, 12);
  const day = 86_400_000;
  const cases = [
    ['vor 1 Tag', now - day], ['vor 4 Tagen', now - 4 * day], ['vor 1 Woche', now - 7 * day],
    ['vor 6 Wochen', now - 42 * day], ['vor 2 Monaten', now - 60 * day], ['vor einem Monat', now - 30 * day],
    ['vor 3 Stunden', now - 3 * 3_600_000], ['heute', now], ['gestern', now - day],
  ];
  const bad = cases.filter(([s, want]) => relativeLabelToEpochMs(s, now) !== want);
  if (bad.length === 0) pass('relativeLabelToEpochMs converts German relative labels');
  else fail(`relativeLabelToEpochMs wrong for ${JSON.stringify(bad.map(([s]) => [s, relativeLabelToEpochMs(s, now)]))}`);
  if (relativeLabelToEpochMs('demnächst', now) === undefined && relativeLabelToEpochMs(null, now) === undefined) {
    pass('relativeLabelToEpochMs → undefined for an unknown label');
  } else fail('relativeLabelToEpochMs should be undefined for an unknown label');

  // toJob
  const j = toJob(ad(42, { title: 'CRM &amp; Lifecycle Manager', company: { name: 'Acme &amp; Co' } }), now);
  if (j?.title === 'CRM & Lifecycle Manager' && j?.company === 'Acme & Co') pass('toJob decodes entities in title and company');
  else fail(`toJob title/company = ${JSON.stringify([j?.title, j?.company])}`);
  if (j?.url === 'https://www.munich-startup.de/jobs/anzeige/42' && j?.location === '' && j?.postedAt === now - 14 * day) {
    pass('toJob builds the board URL, leaves location empty, dates from created_label');
  } else fail(`toJob = ${JSON.stringify(j)}`);
  if (toJob(ad(7, { status: 'expired' }), now) === null
    && toJob(ad('7/../x'), now) === null
    && toJob(ad(null), now) === null
    && toJob(ad(8, { title: '' }), now) === null
    && toJob(null, now) === null) {
    pass('toJob drops inactive rows and rows with no numeric id or title');
  } else fail('toJob should drop malformed rows');
  if (toJob(ad(9, { company: null }), now)?.company === 'Munich Startup') pass('toJob falls back to the board name for a missing company');
  else fail('toJob company fallback');

  // fetch(): two pages, redirect:'error', dedup
  {
    const ctx = makeCtx({
      [LIST]: page(listing([ad(1), ad(2), ad(3)], 1, 2)),
      [`${LIST}?page=2`]: page(listing([ad(4), ad(3)], 2, 2)),
    });
    const jobs = await provider.fetch({ name: 'Munich Startup', provider: 'munich-startup' }, ctx);
    if (jobs.length === 4) pass('fetch() reads every page up to last_page and de-duplicates by URL');
    else fail(`fetch() returned ${jobs.length} jobs, expected 4`);
    if (ctx.calls.length === 2 && ctx.calls.every((c) => c.opts.redirect === 'error')) pass('every page request passes redirect: "error"');
    else fail(`calls: ${JSON.stringify(ctx.calls.map((c) => [c.url, c.opts.redirect]))}`);
  }

  // Empty board → [] with no error
  {
    const ctx = makeCtx({ [LIST]: page(listing([], 1, 1, 15, 0)) });
    const jobs = await provider.fetch({ name: 'Munich Startup', provider: 'munich-startup' }, ctx);
    if (Array.isArray(jobs) && jobs.length === 0) pass('fetch() returns [] for an empty board');
    else fail(`empty board returned ${JSON.stringify(jobs)}`);
  }

  // Page 1 markup change → throw
  {
    const ctx = makeCtx({ [LIST]: '<html><a href="/jobs/anzeige/9">job</a></html>' });
    try {
      await provider.fetch({ name: 'Munich Startup', provider: 'munich-startup' }, ctx);
      fail('fetch() should throw when the listing JSON is gone');
    } catch (e) {
      if (/listing/.test(e.message)) pass('fetch() throws when page 1 carries no listing JSON');
      else fail(`unexpected error: ${e.message}`);
    }
  }

  // max_pages cap → warning; page-2 failure → partial + warning without the cap hint
  {
    const pages = {
      [LIST]: page(listing([ad(1), ad(2), ad(3)], 1, 3)),
      [`${LIST}?page=2`]: page(listing([ad(4), ad(5), ad(6)], 2, 3)),
    };
    const { result: capped, errors } = await captureConsoleErrors(() => provider.fetch({ name: 'MS', provider: 'munich-startup', max_pages: 1 }, makeCtx(pages)));
    if (capped.length === 3 && errors.some((m) => /raise max_pages/.test(m))) pass('entry max_pages stops the walk and warns to raise it');
    else fail(`cap: ${capped.length} jobs, errors=${JSON.stringify(errors)}`);

    const broken = { ...pages, [`${LIST}?page=2`]: Object.assign(new Error('HTTP 400'), { status: 400 }) };
    const { result: partial, errors: errs } = await captureConsoleErrors(() => provider.fetch({ name: 'MS', provider: 'munich-startup' }, makeCtx(broken)));
    if (partial.length === 3 && errs.some((m) => /truncated at page 2/.test(m)) && !errs.some((m) => /raise max_pages/.test(m))) {
      pass('a page-2 failure keeps page 1 and warns (no "raise max_pages")');
    } else fail(`page-2 failure: ${partial.length} jobs, errors=${JSON.stringify(errs)}`);
  }

  // Probe: one request; rejection propagates unwrapped
  {
    const ctx = makeCtx({
      [LIST]: page(listing([ad(1), ad(2), ad(3)], 1, 2)),
      [`${LIST}?page=2`]: page(listing([ad(4)], 2, 2)),
    }, { maxPages: 1 });
    const { errors } = await captureConsoleErrors(() => provider.fetch({ name: 'MS', provider: 'munich-startup' }, ctx));
    if (ctx.calls.length === 1 && errors.length === 0) pass('ctx.maxPages: 1 → exactly one list request, no cap warning');
    else fail(`probe: ${ctx.calls.length} calls, errors=${JSON.stringify(errors)}`);

    class ProbeBudget extends Error {}
    const sentinel = new ProbeBudget('budget');
    try {
      await provider.fetch({ name: 'MS', provider: 'munich-startup' }, makeCtx({ [LIST]: sentinel }, { maxPages: 1 }));
      fail('probe rejection should propagate');
    } catch (e) {
      if (e === sentinel) pass('a ctx.fetch* rejection during a probe propagates unwrapped');
      else fail(`probe rejection was rewrapped: ${e?.message}`);
    }
  }
} catch (e) {
  fail(`munich-startup provider tests crashed: ${e.stack || e.message}`);
}
