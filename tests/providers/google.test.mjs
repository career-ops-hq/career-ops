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

    // google.com/robots.txt disallows every results URL carrying page=, for
    // every crawler. No request this provider builds may contain it.
    calls.every((c) => !/[?&]page=/.test(c.url))
      ? pass('google.fetch() never sends the robots-disallowed page= parameter')
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

  // max_pages does not apply here: pages past the first are unreachable without
  // the disallowed parameter, so raising it must not add requests.
  {
    const { ctx, calls } = recordingCtx(() => RESULTS_HTML);
    await provider.fetch({ ...ENTRY, max_pages: 25 }, ctx);
    calls.length === 2 && calls.every((c) => !/[?&]page=/.test(c.url))
      ? pass('google.fetch() ignores max_pages — one page per query is all robots.txt allows')
      : fail(`google with max_pages=25 made ${calls.length} requests`);
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
