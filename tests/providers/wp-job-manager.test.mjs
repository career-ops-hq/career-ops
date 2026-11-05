// tests/providers/wp-job-manager.test.mjs — offline coverage for the generic
// WP Job Manager `?feed=job_feed` provider. Fixtures are invented.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';

console.log('\nProvider — wp-job-manager');

const item = (n, { host = 'jobs.example.com', title = `Engineer ${n}` } = {}) => `
    <item>
      <title>${title}</title>
      <link>https://${host}/job/engineer-${n}/</link>
      <pubDate>Mon, 02 Jun 2025 12:00:00 +0000</pubDate>
      <job_listing:company><![CDATA[Acme ${n}]]></job_listing:company>
      <job_listing:location><![CDATA[Remote]]></job_listing:location>
    </item>`;
const feed = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
  xmlns:job_listing="https://jobs.example.com">
  <channel>
    <title>Jobs | Example Board</title>
    <link>https://jobs.example.com</link>
    ${items.join('')}
  </channel>
</rss>`;
const fullPage = (from) => feed(Array.from({ length: 100 }, (_, i) => item(from + i)));

const ENTRY = { name: 'Example Board', provider: 'wp-job-manager', careers_url: 'https://jobs.example.com/jobs/?x=1' };

/** A ctx whose fetchText serves `pages[n-1]` for `paged=n` (string, or Error to throw). */
function makeCtx(pages, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      ...extra,
      sleep: async () => {},
      async fetchText(url, opts) {
        calls.push({ url, opts });
        const page = Number(new URL(url).searchParams.get('paged') || 1);
        const body = pages[page - 1];
        if (body instanceof Error) throw body;
        return body ?? feed([]);
      },
    },
  };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/wp-job-manager.mjs')).href);
  const { resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const wpjm = mod.default;
  const { parseWpJobManagerFeed, resolveHost, buildFeedUrl } = mod;

  if (wpjm.id === 'wp-job-manager') pass('id is "wp-job-manager"');
  else fail(`id=${JSON.stringify(wpjm.id)}`);

  if (typeof wpjm.detect !== 'function') pass('no detect(): a WordPress host cannot be recognized, so it is explicit-only');
  else fail('detect() should be omitted');

  const routed = resolveProvider(ENTRY, new Map([['wp-job-manager', wpjm]]));
  if (routed?.provider === wpjm) pass('registry routes an explicit provider: wp-job-manager entry');
  else fail(`registry route=${JSON.stringify(routed)}`);

  // --- host resolution: only the host survives; junk → null, no throw ---
  if (resolveHost(ENTRY) === 'jobs.example.com') pass('resolveHost keeps the host and drops path and query');
  else fail(`resolveHost=${resolveHost(ENTRY)}`);
  if (resolveHost({ api: 'https://WWW.Example.com.' }) === 'www.example.com') pass('resolveHost falls back to api and normalizes case and the root dot');
  else fail(`resolveHost(api)=${resolveHost({ api: 'https://WWW.Example.com.' })}`);
  const junk = [{}, null, { careers_url: 42 }, { careers_url: 'not a url' }, { careers_url: 'http://jobs.example.com' },
    { careers_url: 'https://jobs.example.com:8443/' }, { careers_url: 'https://user:pw@jobs.example.com/' },
    { careers_url: 'https://localhost/' }];
  if (junk.every((e) => resolveHost(e) === null)) pass('resolveHost returns null for missing, malformed, non-https, port, credentials and dotless hosts');
  else fail(`resolveHost accepted junk: ${junk.filter((e) => resolveHost(e) !== null).map((e) => JSON.stringify(e)).join(', ')}`);

  if (buildFeedUrl('jobs.example.com', 1) === 'https://jobs.example.com/?feed=job_feed&posts_per_page=100'
    && buildFeedUrl('jobs.example.com', 3) === 'https://jobs.example.com/?feed=job_feed&posts_per_page=100&paged=3') {
    pass('buildFeedUrl asks for 100 per page and adds paged= past the first');
  } else fail(`buildFeedUrl=${buildFeedUrl('jobs.example.com', 3)}`);

  // --- parsing ---
  const mixed = feed([
    item(1, { title: 'R&amp;D Engineer' }),
    item(2, { host: 'www.jobs.example.com' }),
    item(3, { host: 'evil.example' }),
    item(4, { title: '' }),
    `<item><title>No link</title></item>`,
  ]);
  const { jobs, rawCount } = parseWpJobManagerFeed(mixed, 'jobs.example.com');
  if (rawCount === 5 && jobs.length === 2) pass('keeps on-host items and drops off-host, untitled and linkless ones');
  else fail(`rawCount=${rawCount} jobs=${JSON.stringify(jobs)}`);
  const [first] = jobs;
  if (first?.title === 'R&D Engineer' && first.company === 'Acme 1' && first.location === 'Remote'
    && first.url === 'https://jobs.example.com/job/engineer-1/' && first.postedAt === Date.UTC(2025, 5, 2, 12)) {
    pass('maps title (entity-decoded), company, location, board URL and postedAt');
  } else fail(`first=${JSON.stringify(first)}`);
  if (jobs[1]?.url === 'https://www.jobs.example.com/job/engineer-2/') pass('treats the www. variant as the same board');
  else fail(`jobs[1]=${JSON.stringify(jobs[1])}`);

  const empty = parseWpJobManagerFeed(feed([]), 'jobs.example.com');
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('an RSS channel with no items is an empty board');
  else fail(`empty=${JSON.stringify(empty)}`);

  for (const [label, body] of [['an HTML page', '<!doctype html><html><body>Jobs</body></html>'], ['an empty body', ''],
    ['a non-RSS body', '{"jobs":[]}'], ['undefined', undefined]]) {
    try {
      parseWpJobManagerFeed(body, 'jobs.example.com');
      fail(`${label} should throw`);
    } catch (e) {
      if (/expected an RSS job_feed/.test(e.message) && e.message.includes(label)) pass(`throws on ${label}, naming what it got`);
      else fail(`${label}: unexpected error ${e.message}`);
    }
  }
  try {
    parseWpJobManagerFeed(feed([item(1, { host: 'other.example' })]), 'jobs.example.com');
    fail('items present but none usable should throw');
  } catch (e) {
    if (/1 feed items .* none parsed/.test(e.message)) pass('throws when items are present but none parse');
    else fail(`unexpected error ${e.message}`);
  }

  // --- fetch: guard, redirect, pagination ---
  {
    const { ctx, calls } = makeCtx([fullPage(1)]);
    try {
      await wpjm.fetch({ name: 'Bad', careers_url: 'http://jobs.example.com' }, ctx);
      fail('fetch with a non-https careers_url should throw');
    } catch (e) {
      if (calls.length === 0 && /needs an https careers_url/.test(e.message)) pass('host guard throws before any request');
      else fail(`calls=${calls.length} err=${e.message}`);
    }
  }

  {
    const { ctx, calls } = makeCtx([fullPage(1), fullPage(101), feed([item(200), item(201)])]);
    const out = await wpjm.fetch(ENTRY, ctx);
    if (out.length === 201 && calls.length === 3 && out.wpJobManagerTruncated === undefined) {
      pass('walks pages until a short page (100 + 100 + 2, one repeated posting dropped)');
    } else fail(`jobs=${out.length} calls=${calls.length} truncated=${out.wpJobManagerTruncated}`);
    if (calls.every((c) => c.opts?.redirect === 'error')) pass('every request passes redirect: "error"');
    else fail(`redirect opts=${JSON.stringify(calls.map((c) => c.opts?.redirect))}`);
    if (calls.every((c) => new URL(c.url).hostname === 'jobs.example.com' && new URL(c.url).pathname === '/')) {
      pass('requests go to the board host with the fixed feed path');
    } else fail(`urls=${calls.map((c) => c.url).join(' ')}`);
  }

  {
    // A board (or a cache in front of it) that ignores paged= serves page 1 forever.
    const { ctx, calls } = makeCtx(Array.from({ length: 30 }, () => fullPage(1)));
    let out;
    const { errors } = await captureConsoleErrors(async () => { out = await wpjm.fetch(ENTRY, ctx); });
    const text = errors.join('\n');
    if (calls.length === 2 && out.length === 100 && out.wpJobManagerTruncated === true
      && /ignore paged=/.test(text) && !/raise max_pages/.test(text)) {
      pass('a full page with nothing new stops the walk and warns the board may ignore paged=');
    } else fail(`calls=${calls.length} jobs=${out?.length} truncated=${out?.wpJobManagerTruncated} stderr=${text}`);
  }

  {
    const pages = Array.from({ length: 30 }, (_, i) => fullPage(1 + i * 100));
    const { ctx, calls } = makeCtx(pages);
    let out;
    const { errors } = await captureConsoleErrors(async () => { out = await wpjm.fetch(ENTRY, ctx); });
    const text = errors.join('\n');
    if (calls.length === 20 && out.wpJobManagerTruncated === true && /raise max_pages/.test(text)) {
      pass('stops at its own DEFAULT_MAX_PAGES on an endless board and warns to raise max_pages');
    } else fail(`calls=${calls.length} truncated=${out?.wpJobManagerTruncated} stderr=${text}`);

    const many = Array.from({ length: 150 }, (_, i) => fullPage(1 + i * 100));
    const capped = makeCtx(many);
    await captureConsoleErrors(async () => { await wpjm.fetch({ ...ENTRY, max_pages: 1000 }, capped.ctx); });
    if (capped.calls.length === 100) pass('a configured max_pages is clamped to MAX_PAGES_CAP (100)');
    else fail(`max_pages=1000 calls=${capped.calls.length}`);

    const raised = makeCtx(pages);
    const r = await captureConsoleErrors(async () => wpjm.fetch({ ...ENTRY, max_pages: 50 }, raised.ctx));
    if (raised.calls.length === 31 && r.result.length === 3000 && r.result.wpJobManagerTruncated === undefined && r.errors.length === 0) {
      pass('a raised max_pages walks to the natural end (an empty page) without a warning');
    } else fail(`max_pages=50 calls=${raised.calls.length} jobs=${r.result?.length} stderr=${r.errors.join('|')}`);
  }

  {
    const { ctx, calls } = makeCtx([fullPage(1), fullPage(101)], { maxPages: 1 });
    let out;
    const { errors } = await captureConsoleErrors(async () => { out = await wpjm.fetch(ENTRY, ctx); });
    if (calls.length === 1 && out.length === 100 && errors.length === 0) pass('ctx.maxPages: 1 makes exactly one request and does not warn');
    else fail(`probe calls=${calls.length} jobs=${out?.length} stderr=${errors.join('|')}`);
  }

  {
    const budget = new Error('probe budget');
    const { ctx } = makeCtx([budget], { maxPages: 1 });
    try {
      await wpjm.fetch(ENTRY, ctx);
      fail('a probe fetch rejection should propagate');
    } catch (e) {
      if (e === budget) pass('a ctx.fetchText rejection under a probe propagates unwrapped');
      else fail(`probe rejection was rewrapped: ${e.message}`);
    }
  }

  {
    const err = Object.assign(new Error('HTTP 503'), { status: 503 });
    const { ctx, calls } = makeCtx([fullPage(1), err]);
    let out;
    const { errors } = await captureConsoleErrors(async () => { out = await wpjm.fetch(ENTRY, ctx); });
    const text = errors.join('\n');
    if (out.length === 100 && out.wpJobManagerTruncated === true && calls.length > 2
      && /stopped at page 2/.test(text) && !/raise max_pages/.test(text)) {
      pass('a page-2 failure after retry keeps page 1, warns, and does not blame max_pages');
    } else fail(`jobs=${out?.length} truncated=${out?.wpJobManagerTruncated} calls=${calls.length} stderr=${text}`);
  }

  {
    const { ctx } = makeCtx([fullPage(1), '<html><body>Error establishing a database connection</body></html>']);
    const r = await captureConsoleErrors(async () => wpjm.fetch(ENTRY, ctx));
    if (r.result.length === 100 && r.result.wpJobManagerTruncated === true && /an HTML page/.test(r.errors.join('\n'))) {
      pass('a later page that is not RSS keeps the earlier pages and warns');
    } else fail(`jobs=${r.result?.length} stderr=${r.errors.join('|')}`);
  }

  {
    const err = Object.assign(new Error('HTTP 404'), { status: 404 });
    const { ctx } = makeCtx([err]);
    try {
      await wpjm.fetch(ENTRY, ctx);
      fail('a first-page failure should throw');
    } catch (e) {
      if (e === err) pass('a first-page failure throws instead of reading as an empty board');
      else fail(`unexpected error ${e.message}`);
    }
  }
} catch (e) {
  fail(`wp-job-manager provider tests crashed: ${e.stack || e.message}`);
}
