// tests/providers/euremotejobs.test.mjs — offline coverage for the EU Remote
// Jobs provider (providers/euremotejobs.mjs), which reads WP Job Manager's
// `/jm-ajax/get_listings/` endpoint. Fixtures are invented.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';

console.log('\nProvider — euremotejobs');

const card = (n, { title = `Engineer ${n}`, company = `Acme ${n}`, location = 'Spain, Portugal', posted = 'Posted 2 days ago', href } = {}) => `
<li id="job_listing-${n}" class="job_listing job-type-full-time post-${n}" data-title="${title} at ${company}" data-href="${href ?? `https://euremotejobs.com/job/engineer-${n}/`}">
	<a href="${href ?? `https://euremotejobs.com/job/engineer-${n}/`}" class="job_listing-clickbox"></a>
	<div class="job_listing-logo"><img class="company_logo" src="https://euremotejobs.com/x.png" alt="${company}" /></div><div class="job_listing-about">
		<div class="job_listing-position job_listing__column">
			<h3 class="job_listing-title">${title}</h3>
			<div class="job_listing-company">
				<strong>${company}</strong> 							</div>
		</div>
		<div class="job_listing-location job_listing__column">
			<a class="google_map_link" href="http://maps.google.com/maps?q=x&#038;zoom=14" target="_blank">${location}</a>		</div>
		<ul class="job_listing-meta job_listing__column">
			<li class="job_listing-type job-type full-time">Full Time</li>
			<li class="job_listing-date">${posted}</li>
		</ul>
	</div>
</li>
`;
const response = (cards, maxNumPages = 5) => ({
  found_jobs: cards.length > 0,
  showing: '',
  max_num_pages: cards.length > 0 ? maxNumPages : 0,
  showing_links: '',
  html: cards.length > 0 ? cards.join('') : '\t<li class="no_job_listings_found">There are no listings matching your search.</li>\n',
});
const fullPage = (from, maxNumPages = 500) => response(Array.from({ length: 100 }, (_, i) => card(from + i)), maxNumPages);

const ENTRY = { name: 'EU Remote Jobs', provider: 'euremotejobs' };

/** A ctx whose fetchJson serves `pages[n-1]` for `page=n` (object, or Error to throw). */
function makeCtx(pages, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      ...extra,
      sleep: async () => {},
      fetchText: async () => { throw new Error('fetchText should not be called'); },
      async fetchJson(url, opts) {
        calls.push({ url, opts });
        const page = Number(new URL(url).searchParams.get('page') || 1);
        const body = pages[page - 1];
        if (body instanceof Error) throw body;
        return body ?? response([]);
      },
    },
  };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/euremotejobs.mjs')).href);
  const p = mod.default;
  const { parseEuRemoteJobsListings, parseRelativePosted, listUrl } = mod;

  if (p.id === 'euremotejobs') pass('id is "euremotejobs"');
  else fail(`id=${JSON.stringify(p.id)}`);

  // detect() — explicit-only
  const hit = p.detect({ name: 'X', provider: 'euremotejobs' });
  if (hit && hit.url === 'https://euremotejobs.com/jobs/') pass('detect() resolves provider:euremotejobs with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (p.detect({ name: 'X', careers_url: 'https://euremotejobs.com/jobs/' }) === null
    && p.detect(null) === null && p.detect({ provider: 'wp-job-manager' }) === null) {
    pass('detect() returns null without provider:euremotejobs (no URL auto-claim, no throw on null)');
  } else fail('detect() should be explicit-only');

  if (listUrl(3) === 'https://euremotejobs.com/jm-ajax/get_listings/?per_page=100&page=3'
    && !/search_/.test(listUrl(1))) {
    pass('listUrl() targets the fixed AJAX path with per_page/page only (no robots-disallowed search_* params)');
  } else fail(`listUrl(3)=${listUrl(3)}`);

  // parseRelativePosted
  const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
  const rel = [
    ['Posted 2 hours ago', NOW - 2 * 3_600_000],
    ['Posted 1 day ago', NOW - 86_400_000],
    ['Posted 3 weeks ago', NOW - 21 * 86_400_000],
    ['Posted 4 months ago', NOW - 120 * 86_400_000],
    ['Posted 15 mins ago', NOW - 15 * 60_000],
  ];
  if (rel.every(([t, want]) => parseRelativePosted(t, NOW) === want)) pass('parseRelativePosted handles mins/hours/days/weeks/months');
  else fail(`parseRelativePosted = ${JSON.stringify(rel.map(([t]) => parseRelativePosted(t, NOW)))}`);
  if (parseRelativePosted('Posted recently', NOW) === undefined && parseRelativePosted('', NOW) === undefined) {
    pass('parseRelativePosted leaves an unrecognised label undefined (no invented date)');
  } else fail('parseRelativePosted should not invent a date');

  // parseEuRemoteJobsListings — normalization, entity decoding, malformed rows dropped
  const sample = response([
    card(1, { title: 'Data &amp; ML Engineer', company: 'Acme &amp; Co', location: 'Germany, UK', posted: 'Posted 2 hours ago' }),
    card(2, { href: 'https://evil.example.com/job/x/' }),      // off-host → dropped
    card(3, { title: '' }),                                      // no title → dropped
    card(4, { posted: 'Posted sometime' }),                      // unparseable date → kept, no postedAt
  ]);
  const parsed = parseEuRemoteJobsListings(sample, NOW);
  const j0 = parsed.jobs[0];
  if (parsed.rawCount === 4 && parsed.jobs.length === 2) pass('keeps well-formed cards, drops off-host and title-less ones, rawCount counts every card');
  else fail(`rawCount=${parsed.rawCount} jobs=${parsed.jobs.length}`);
  if (j0?.title === 'Data & ML Engineer' && j0?.company === 'Acme & Co' && j0?.location === 'Germany, UK'
    && j0?.url === 'https://euremotejobs.com/job/engineer-1/' && j0?.postedAt === NOW - 2 * 3_600_000) {
    pass('decodes entities in title/company and maps location, url and relative date');
  } else fail(`row 0 = ${JSON.stringify(j0)}`);
  if (parsed.jobs[1] && !('postedAt' in parsed.jobs[1])) pass('an unparseable date label omits postedAt');
  else fail(`row 1 = ${JSON.stringify(parsed.jobs[1])}`);

  // Empty vs broken
  const empty = parseEuRemoteJobsListings(response([]), NOW);
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('found_jobs:false (an empty board) → []');
  else fail(`empty = ${JSON.stringify(empty)}`);
  for (const [label, body] of [
    ['a bare string', 'oops'],
    ['null', null],
    ['an array', []],
    ['an object without html', { found_jobs: true }],
    ['html of the wrong type', { found_jobs: true, html: [] }],
    ['found_jobs:true with no card (markup change)', { found_jobs: true, max_num_pages: 3, html: '<div class="job-card">x</div>' }],
  ]) {
    try {
      parseEuRemoteJobsListings(body, NOW);
      fail(`${label} should throw`);
    } catch (e) {
      if (/euremotejobs: /.test(e.message)) pass(`${label} → descriptive throw`);
      else fail(`${label} threw an unrelated error: ${e.message}`);
    }
  }

  // fetch(): pagination, redirect:'error', short-page stop, fixed host
  {
    const { ctx, calls } = makeCtx([fullPage(1), fullPage(101), response([card(201), card(202)], 3)]);
    const r = await captureConsoleErrors(() => p.fetch(ENTRY, ctx));
    if (r.result.length === 202 && calls.length === 3 && r.errors.length === 0) pass('walks pages to the short last page without a warning');
    else fail(`jobs=${r.result?.length} calls=${calls.length} stderr=${r.errors.join('|')}`);
    if (calls.every((c) => c.opts?.redirect === 'error')) pass("every request passes redirect:'error'");
    else fail(`redirect opts=${JSON.stringify(calls.map((c) => c.opts?.redirect))}`);
    if (calls.every((c) => new URL(c.url).hostname === 'euremotejobs.com' && new URL(c.url).protocol === 'https:')) {
      pass('every request goes to https://euremotejobs.com');
    } else fail(`urls=${calls.map((c) => c.url).join(' ')}`);
  }

  {
    // max_num_pages ends the walk even when the last page is full.
    const { ctx, calls } = makeCtx([fullPage(1, 2), fullPage(101, 2), fullPage(201, 2)]);
    const r = await captureConsoleErrors(() => p.fetch(ENTRY, ctx));
    if (calls.length === 2 && r.result.length === 200 && r.errors.length === 0) pass('stops at the board-reported max_num_pages without a warning');
    else fail(`calls=${calls.length} jobs=${r.result?.length} stderr=${r.errors.join('|')}`);
  }

  {
    // An endless board: own DEFAULT_MAX_PAGES (100) stops it, and it warns.
    const pages = Array.from({ length: 120 }, (_, i) => fullPage(1 + i * 100, 10_000));
    const { ctx, calls } = makeCtx(pages);
    const r = await captureConsoleErrors(() => p.fetch(ENTRY, ctx));
    if (calls.length === 100 && /raise max_pages/.test(r.errors.join('\n'))) pass('stops at its own DEFAULT_MAX_PAGES even when the board reports more, and warns');
    else fail(`calls=${calls.length} stderr=${r.errors.join('|')}`);

    const capped = makeCtx(Array.from({ length: 250 }, (_, i) => fullPage(1 + i * 100, 10_000)));
    await captureConsoleErrors(() => p.fetch({ ...ENTRY, max_pages: 5000 }, capped.ctx));
    if (capped.calls.length === 200) pass('a configured max_pages is clamped to MAX_PAGES_CAP (200)');
    else fail(`max_pages=5000 calls=${capped.calls.length}`);

    const two = makeCtx(pages);
    const r2 = await captureConsoleErrors(() => p.fetch({ ...ENTRY, max_pages: 2 }, two.ctx));
    if (two.calls.length === 2 && r2.result.length === 200 && /raise max_pages/.test(r2.errors.join('\n'))) pass('entry max_pages: 2 fetches two pages and warns');
    else fail(`max_pages=2 calls=${two.calls.length} stderr=${r2.errors.join('|')}`);
  }

  {
    // Probe: ctx.maxPages: 1 → exactly one request, no max_pages warning.
    const { ctx, calls } = makeCtx([fullPage(1), fullPage(101)], { maxPages: 1 });
    const r = await captureConsoleErrors(() => p.fetch(ENTRY, ctx));
    if (calls.length === 1 && r.result.length === 100 && r.errors.length === 0) pass('ctx.maxPages: 1 makes exactly one list request and does not warn');
    else fail(`probe calls=${calls.length} jobs=${r.result?.length} stderr=${r.errors.join('|')}`);
  }

  {
    // Probe: a ctx.fetchJson rejection propagates unwrapped.
    const budget = new Error('probe budget');
    const { ctx } = makeCtx([fullPage(1), budget], { maxPages: 2 });
    try {
      await p.fetch(ENTRY, ctx);
      fail('a probe fetch rejection should propagate');
    } catch (e) {
      if (e === budget) pass('a ctx.fetchJson rejection under a probe propagates unwrapped');
      else fail(`probe rejection was rewrapped: ${e.message}`);
    }
  }

  {
    // Real scan: page 2 fails after retry → keep page 1, warn, do not blame max_pages.
    const err = Object.assign(new Error('HTTP 503'), { status: 503 });
    const { ctx, calls } = makeCtx([fullPage(1), err]);
    const r = await captureConsoleErrors(() => p.fetch(ENTRY, ctx));
    const text = r.errors.join('\n');
    if (r.result.length === 100 && calls.length > 2 && /page 2 failed/.test(text) && !/raise max_pages/.test(text)) {
      pass('a page-2 failure after retry keeps page 1, warns, and does not blame max_pages');
    } else fail(`jobs=${r.result?.length} calls=${calls.length} stderr=${text}`);
  }

  {
    // First page failure throws (never reads as an empty board).
    const err = Object.assign(new Error('HTTP 404'), { status: 404 });
    const { ctx } = makeCtx([err]);
    try {
      await p.fetch(ENTRY, ctx);
      fail('a first-page failure should throw');
    } catch (e) {
      if (e === err) pass('a first-page failure throws instead of reading as an empty board');
      else fail(`unexpected error ${e.message}`);
    }
  }
} catch (e) {
  fail(`euremotejobs provider tests crashed: ${e.message}`);
}
