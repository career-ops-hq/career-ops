// tests/providers/google.test.mjs — google provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — google');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/google.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'google') pass('google.id is "google"');
  else fail(`google.id is ${JSON.stringify(provider.id)}`);

  if (provider.detect({ name: 'X' }) === null) pass('google.detect() returns null with no config');
  else fail('google.detect() should return null with no config');

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('google.detect() ignores careers_url — config key only');
  } else {
    fail('google.detect() should not fire on careers_url alone');
  }

  if (typeof provider.fetch === 'function') pass('google.fetch() is callable');
  else fail('google.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  // ── behaviour: robots.txt compliance is the point of this provider ────────
  const recordingCtx = (respond) => {
    const calls = [];
    const fetchText = async (url, opts = {}) => { const call = { url, opts, n: calls.length }; calls.push(call); return respond(call); };
    return { calls, ctx: { transport: 'http', fetchText, fetchJson: async () => { throw new Error('google must not call fetchJson'); } } };
  };
  const RESULTS_HTML = `<!doctype html><a href="/about/careers/applications/jobs/results/123456789-senior-business-strategy-manager">x</a>
    <a href="/about/careers/applications/jobs/results/987654321-corporate-development-lead">y</a>`;
  const ENTRY = { name: 'Google', google: { queries: ['business strategy', 'corporate development'], location: 'United States' } };

  {
    const { ctx, calls } = recordingCtx(() => RESULTS_HTML);
    const jobs = await provider.fetch(ENTRY, ctx);

    // With no `max_pages` the provider keeps its single-page behavior: page 1
    // is the bare URL and no request carries page=.
    calls.every((c) => !/[?&]page=/.test(c.url))
      ? pass('google.fetch() sends no page= parameter without max_pages')
      : fail(`google sent a paginated URL: ${calls.map((c) => c.url).join(' ')}`);

    calls.every((c) => /[?&]sort_by=date\b/.test(c.url))
      ? pass('google.fetch() asks for the newest postings (sort_by=date) on its single page')
      : fail(`google URLs missing sort_by=date: ${calls.map((c) => c.url).join(' ')}`);

    calls.length === 2
      ? pass('google.fetch() makes exactly one request per query (2 queries -> 2 requests)')
      : fail(`google made ${calls.length} requests for 2 queries`);

    const j = jobs.find((x) => x.externalId === '123456789');
    j && j.title === 'Senior Business Strategy Manager'
      && j.url === 'https://www.google.com/about/careers/applications/jobs/results/123456789-senior-business-strategy-manager'
      && j.company === 'Google'
      ? pass('google.fetch() falls back to the slug title and entry name for a bare link with no card markup')
      : fail(`google mapping: ${JSON.stringify(jobs)}`);

    calls.every((c) => c.opts?.redirect === 'error')
      ? pass('google.fetch() passes redirect:"error" on every recorded request')
      : fail(`google redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
  }

  // The live page's card markup (trimmed from a 2026-09-24 results page). The
  // same results list other Alphabet companies' postings, so the card's
  // employer is the company, the <h3> is the title (a slug loses "/", "&" and
  // casing), and "+N more" is Google collapsing the location list.
  const card = (id, slug, title, employerLine) => `<li class="lLd3Je"><div><h3 class="QJPWVe">${title}</h3>`
    + `<p class="l103df">${employerLine}</p><div class="Xsxa1e"><h4>Minimum qualifications</h4></div>`
    + `<a class="WpHeLc" href="jobs/results/${id}-${slug}?q=business+operations&amp;sort_by=date" aria-label="Learn more about ${title}" jsname="hSRGPd"></a></div></li>`;
  const CARDS_HTML = `<!doctype html><h3 class="mUzaXb">Filters</h3><ul>`
    + card('127792359805985478', 'product-manager-ii-youtube-ads', 'Product Manager II, YouTube Ads &amp; AI/ML',
      'YouTube | <span class="pwO9Dc"><span class="r0wTof ">Kirkland, WA, USA</span><span class="r0wTof p3oCrc">; Mountain View, CA, USA</span><span class="BVHzed">; +2 more</span><span class="Z2gFhf">; +1 more</span></span>')
    + card('95645113710977734', 'associate-business-operations-and-strategy', 'Associate, Business Operations and Strategy',
      'Google | <span class="pwO9Dc"><span class="r0wTof ">San Jose, CA, USA</span></span>')
    + `</ul>`;
  {
    const { ctx } = recordingCtx(() => CARDS_HTML);
    const jobs = await provider.fetch({ ...ENTRY, google: { queries: ['business operations'] } }, ctx);
    const yt = jobs.find((x) => x.externalId === '127792359805985478');
    const g = jobs.find((x) => x.externalId === '95645113710977734');
    yt?.company === 'YouTube' && g?.company === 'Google'
      ? pass('google.fetch() attributes each posting to the employer its card names, not the entry name')
      : fail(`google employer attribution: ${JSON.stringify(jobs.map((x) => [x.externalId, x.company]))}`);
    yt?.title === 'Product Manager II, YouTube Ads & AI/ML' && g?.title === 'Associate, Business Operations and Strategy'
      ? pass('google.fetch() takes the title from the card, entities decoded, not from the slug')
      : fail(`google card titles: ${JSON.stringify(jobs.map((x) => x.title))}`);
    yt?.location === 'Kirkland, WA, USA; Mountain View, CA, USA' && g?.location === 'San Jose, CA, USA'
      ? pass('google.fetch() reads the card locations and drops Google\'s "+N more" overflow')
      : fail(`google card locations: ${JSON.stringify(jobs.map((x) => x.location))}`);
    yt?.url === 'https://www.google.com/about/careers/applications/jobs/results/127792359805985478-product-manager-ii-youtube-ads'
      ? pass('google.fetch() rebuilds the public URL without the query string the card link carries')
      : fail(`google card url: ${yt?.url}`);
  }

  // Entity-escaped markup in a card must not decode into live markup.
  {
    const hostile = card('555000111', 'x', 'Analyst &lt;script&gt;alert(1)&lt;/script&gt; Ops',
      'Google &lt;img src=x onerror=alert(1)&gt; | <span class="r0wTof ">&lt;b&gt;Austin, TX, USA&lt;/b&gt;</span>');
    const { ctx } = recordingCtx(() => `<ul>${hostile}</ul>`);
    const [j] = await provider.fetch({ ...ENTRY, google: { queries: ['x'] } }, ctx);
    j && ![j.title, j.company, j.location].some((v) => /<\/?[a-z]/i.test(v))
      ? pass('google.fetch() never turns entity-escaped markup into live tags')
      : fail(`google decoded markup: ${JSON.stringify(j && [j.title, j.company, j.location])}`);
  }

  // Rule 6 changed in #6691: robots.txt no longer gates the paginated URLs, so
  // max_pages pages through the results (#6694). One query here: page 2 brings
  // one new id and one duplicate, page 3 brings nothing new, so the walk stops
  // before the budget runs out.
  {
    const PAGE2_HTML = `<!doctype html><a href="/about/careers/applications/jobs/results/555666777-head-of-strategy">z</a>
      <a href="/about/careers/applications/jobs/results/123456789-senior-business-strategy-manager">x</a>`;
    const { ctx, calls } = recordingCtx((call) => (/[?&]page=2\b/.test(call.url) ? PAGE2_HTML : RESULTS_HTML));
    const jobs = await provider.fetch({ ...ENTRY, max_pages: 5, google: { queries: ['business strategy'], location: 'United States' } }, ctx);

    calls.length === 3 && !/[?&]page=/.test(calls[0].url) && /[?&]page=2\b/.test(calls[1].url) && /[?&]page=3\b/.test(calls[2].url)
      ? pass('google.fetch() pages with page=N and stops when a page adds no new ids')
      : fail(`google paging walk: ${calls.map((c) => c.url).join(' ')}`);

    jobs.filter((x) => x.externalId === '123456789').length === 1
      ? pass('google.fetch() dedupes an id that repeats on a later page')
      : fail(`google dedupe across pages: ${JSON.stringify(jobs.map((x) => x.externalId))}`);

    jobs.some((x) => x.externalId === '555666777')
      ? pass('google.fetch() keeps the postings only a deeper page carries')
      : fail(`google page-2 posting missing: ${JSON.stringify(jobs.map((x) => x.externalId))}`);

    calls.every((c) => c.opts?.redirect === 'error')
      ? pass('google.fetch() passes redirect:"error" on paginated requests too')
      : fail(`google paginated redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
  }

  // Paged requests pause between pages and the pause is ctx.sleep - the
  // framework's watchdog-aware cancellation checkpoint (kalibrr/gupy convention).
  {
    const PAGE2_NEW = `<!doctype html><a href="/about/careers/applications/jobs/results/555666777-head-of-strategy">z</a>`;
    const sleeps = [];
    const { ctx, calls } = recordingCtx((call) => (/[?&]page=2\b/.test(call.url) ? PAGE2_NEW : RESULTS_HTML));
    ctx.sleep = async (ms) => { sleeps.push(ms); };
    await provider.fetch({ ...ENTRY, max_pages: 3, google: { queries: ['business strategy'], location: 'United States' } }, ctx);

    calls.length === 3 && sleeps.length === 2
      ? pass('google.fetch() pauses on ctx.sleep between paged requests')
      : fail(`google inter-page sleep: ${calls.length} calls, ${sleeps.length} sleeps`);
  }

  // A deeper page failing keeps what earlier pages collected; a probe sees the
  // same rejection unwrapped (kalibrr's failure contract).
  {
    const { ctx } = recordingCtx((call) => { if (/[?&]page=2\b/.test(call.url)) throw new Error('boom'); return RESULTS_HTML; });
    const jobs = await provider.fetch({ ...ENTRY, max_pages: 3, google: { queries: ['business strategy'], location: 'United States' } }, ctx);

    jobs.length === 2
      ? pass('google.fetch() keeps earlier pages when a deeper page fails')
      : fail(`google deeper-page failure lost the board: ${jobs.length} jobs`);

    let probeThrew = false;
    try {
      await provider.fetch({ ...ENTRY, max_pages: 3, google: { queries: ['business strategy'], location: 'United States' } }, { ...ctx, maxPages: 3 });
    } catch {
      probeThrew = true;
    }
    probeThrew
      ? pass('google.fetch() probe sees a deeper-page rejection unwrapped')
      : fail('google probe swallowed a deeper-page rejection');
  }

  // Overlapping queries are the norm, so a later query's page 1 can repeat ids
  // an earlier query already collected. That is not the ignored-page re-serve
  // the stop rule guards against: the query's own walk is only one page in and
  // its page 2 can still carry new postings. The stop decision is per query.
  {
    const Q2_PAGE2_HTML = `<!doctype html><a href="/about/careers/applications/jobs/results/111222333-strategy-ops-lead">w</a>`;
    const { ctx, calls } = recordingCtx((call) =>
      (/q=corporate/.test(call.url) && /[?&]page=2\b/.test(call.url) ? Q2_PAGE2_HTML : RESULTS_HTML));
    const jobs = await provider.fetch({ ...ENTRY, max_pages: 5 }, ctx);

    calls.some((c) => /q=corporate/.test(c.url) && /[?&]page=2\b/.test(c.url))
      ? pass('google.fetch() keeps paging a later query whose page 1 repeats an earlier query\'s ids')
      : fail(`google cut the second query at page 1: ${calls.map((c) => c.url).join(' ')}`);

    jobs.some((x) => x.externalId === '111222333')
      ? pass('google.fetch() keeps the postings a later query\'s page 2 carries')
      : fail(`google lost the later query's page-2 posting: ${JSON.stringify(jobs.map((x) => x.externalId))}`);

    calls.filter((c) => /q=business/.test(c.url)).length === 2
      ? pass('google.fetch() still stops a query whose own pages repeat (re-serve stop intact)')
      : fail(`google first-query walk: ${calls.filter((c) => /q=business/.test(c.url)).map((c) => c.url).join(' ')}`);
  }

  // The page budget clamps to the provider's own 20-page ceiling when an entry
  // asks for more, and a page of all-new ids never trips the stop rule.
  {
    const { ctx, calls } = recordingCtx((call) => {
      const m = /[?&]page=(\d+)/.exec(call.url);
      const n = m ? m[1] : '1';
      return `<!doctype html><a href="/about/careers/applications/jobs/results/9999000${n}-x">x</a>`;
    });
    const jobs = await provider.fetch({ ...ENTRY, max_pages: 100, google: { queries: ['business strategy'], location: 'United States' } }, ctx);

    calls.length === 20 && !calls.some((c) => /[?&]page=21\b/.test(c.url))
      ? pass('google.fetch() clamps an oversized max_pages to its 20-page ceiling')
      : fail(`google max_pages=100 walk: ${calls.length} requests`);

    jobs.length === 20
      ? pass('google.fetch() collects one posting from each of the 20 pages')
      : fail(`google 20-page walk collected ${jobs.length} jobs`);
  }

  // The probe budget caps paging: ctx.maxPages wins over the entry's max_pages.
  {
    const { ctx, calls } = recordingCtx(() => RESULTS_HTML);
    await provider.fetch({ ...ENTRY, max_pages: 25 }, { ...ctx, maxPages: 1 });
    calls.length === 1
      ? pass('google.fetch() lets the probe budget cap max_pages')
      : fail(`google probe with max_pages=25 made ${calls.length} requests`);
  }

  // The probe spends one query, not the whole list.
  {
    const { ctx, calls } = recordingCtx(() => RESULTS_HTML);
    await provider.fetch(ENTRY, { ...ctx, maxPages: 1 });
    calls.length === 1
      ? pass('google.fetch() spends one request under ctx.maxPages')
      : fail(`google probe made ${calls.length} requests`);
  }

} catch (e) {
  fail(`google provider tests crashed: ${e.message}`);
}
