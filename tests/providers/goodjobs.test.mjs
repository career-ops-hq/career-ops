// tests/providers/goodjobs.test.mjs — provider-contract tests for the
// goodjobs aggregator client (providers/goodjobs.mjs).
//
// goodjobs is a self-hosted sibling project, not a scraped board: this
// provider is a thin client of its own `POST /scrape` JSON API. The fixtures
// below exercise the three things that are specific to that shape rather than
// to HTML scraping:
//
//   - base URL resolution defaults to the author's public instance but can be
//     overridden, and only HTTPS is ever accepted (no bare-http, no loopback
//     smuggled in via a scheme downgrade);
//   - the request body requires searchKeywords (goodjobs' own API 400s on an
//     empty keyword) while location/country fall back to goodjobs' own
//     defaults;
//   - the response's `link` field points at whichever of 18 underlying boards
//     produced the posting, so normalization validates it's a well-formed
//     absolute http(s) URL WITHOUT pinning a single hostname (unlike every
//     single-board provider in this repo).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — goodjobs');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/goodjobs.mjs')).href);
  const goodjobs = mod.default;
  const { resolveApiBase, buildRequestBody, normalizeJob } = mod;

  if (goodjobs.id === 'goodjobs') pass('goodjobs.id is "goodjobs"');
  else fail(`goodjobs.id is ${JSON.stringify(goodjobs.id)}`);

  // ── detect(): explicit selection only, like every self-hosted/opt-in provider ──
  {
    const hit = goodjobs.detect({ name: 'goodjobs', provider: 'goodjobs', searchKeywords: 'backend' });
    if (hit && hit.url === 'https://api.goodjobs.io.vn/scrape') {
      pass('detect() resolves provider:goodjobs → the default instance\'s /scrape URL');
    } else {
      fail(`detect() returned ${JSON.stringify(hit)}`);
    }
  }
  if (goodjobs.detect({ name: 'goodjobs', searchKeywords: 'backend' }) === null) {
    pass('detect() returns null without provider:goodjobs');
  } else {
    fail('detect() must require provider:goodjobs');
  }
  {
    const hit = goodjobs.detect({ provider: 'goodjobs', api: 'https://my-goodjobs.example.com', searchKeywords: 'backend' });
    if (hit && hit.url === 'https://my-goodjobs.example.com/scrape') {
      pass('detect() honours an explicit api: override');
    } else {
      fail(`api override drift: ${JSON.stringify(hit)}`);
    }
  }

  // ── resolveApiBase(): HTTPS only, default vs. override ──
  if (resolveApiBase({}) === 'https://api.goodjobs.io.vn') {
    pass('resolveApiBase() defaults to the public api.goodjobs.io.vn instance');
  } else {
    fail(`default base drift: ${resolveApiBase({})}`);
  }
  if (resolveApiBase({ api: 'https://example.com/' }) === 'https://example.com') {
    pass('resolveApiBase() normalizes an explicit api: to its origin');
  } else {
    fail(`origin normalization drift: ${resolveApiBase({ api: 'https://example.com/' })}`);
  }
  {
    let threw = false;
    try { resolveApiBase({ api: 'http://example.com' }); } catch { threw = true; }
    if (threw) pass('resolveApiBase() rejects a bare-http api: URL');
    else fail('a bare-http api: URL must be rejected, not silently accepted');
  }
  {
    // localhost IS a syntactically valid https URL — this provider's own check
    // doesn't reject it (the SSRF guard at connect time does); asserting that
    // here would duplicate _ip-guard.mjs's job. What matters is HTTPS-only.
    if (resolveApiBase({ api: 'https://localhost:8000' }) === 'https://localhost:8000') {
      pass('resolveApiBase() accepts any HTTPS host (loopback is refused later, by the SSRF guard)');
    } else {
      fail('resolveApiBase() should only gate on scheme, not hostname');
    }
  }
  {
    let threw = false;
    try { resolveApiBase({ api: 'not a url' }); } catch { threw = true; }
    if (threw) pass('resolveApiBase() rejects an unparseable api: URL');
    else fail('an unparseable api: URL must throw');
  }

  // ── buildRequestBody(): searchKeywords required, others default ──
  {
    let threw = false;
    try { buildRequestBody({}); } catch { threw = true; }
    if (threw) pass('buildRequestBody() throws without searchKeywords');
    else fail('missing searchKeywords must throw, not silently call the API with an empty keyword');
  }
  {
    let threw = false;
    try { buildRequestBody({ searchKeywords: '   ' }); } catch { threw = true; }
    if (threw) pass('buildRequestBody() throws on a blank (whitespace-only) searchKeywords');
    else fail('blank searchKeywords must throw');
  }
  {
    const body = buildRequestBody({ searchKeywords: 'backend engineer' });
    if (body.keyword === 'backend engineer' && body.location === 'Ho Chi Minh City' && body.country === 'VN') {
      pass('buildRequestBody() defaults location/country to goodjobs\' own API defaults');
    } else {
      fail(`default body drift: ${JSON.stringify(body)}`);
    }
  }
  {
    const body = buildRequestBody({ searchKeywords: 'backend', searchLocation: 'Hanoi', searchCountry: 'VN' });
    if (body.keyword === 'backend' && body.location === 'Hanoi' && body.country === 'VN') {
      pass('buildRequestBody() honours explicit searchLocation/searchCountry');
    } else {
      fail(`explicit body drift: ${JSON.stringify(body)}`);
    }
  }

  // ── normalizeJob(): the response shape from backend/src/models.py's Job ──
  {
    const job = normalizeJob({
      title: '  Backend Engineer  ',
      company: 'Acme Co',
      location: 'Ho Chi Minh City',
      link: 'https://itviec.com/it-jobs/backend-engineer-acme-123',
      source: 'itviec',
      posted: '2 days ago',
      posted_date: '2026-08-28',
      posted_ts: 1798070400,
      description: 'Build backend services.',
      summary_description: '',
      skills: ['python', 'fastapi'],
      logo: '',
    });
    if (job && job.title === 'Backend Engineer' && job.url === 'https://itviec.com/it-jobs/backend-engineer-acme-123') {
      pass('normalizeJob() trims title and carries the original board\'s link through unchanged');
    } else {
      fail(`normalizeJob() drift: ${JSON.stringify(job)}`);
    }
    if (job && job.company === 'Acme Co' && job.location === 'Ho Chi Minh City' && job.description === 'Build backend services.') {
      pass('normalizeJob() carries company/location/description through');
    } else {
      fail(`field drift: ${JSON.stringify(job)}`);
    }
    if (job && job.postedAt === 1798070400 * 1000) {
      pass('normalizeJob() converts posted_ts from Unix SECONDS to epoch ms');
    } else {
      fail(`postedAt drift: ${JSON.stringify(job && job.postedAt)}`);
    }
  }
  // A link from a DIFFERENT board host must pass through as-is — this is an
  // aggregator, so there is deliberately no single hostname to pin.
  {
    const job = normalizeJob({ title: 'Senior Dev', link: 'https://www.linkedin.com/jobs/view/12345' });
    if (job && job.url === 'https://www.linkedin.com/jobs/view/12345') {
      pass('normalizeJob() accepts links to any of the underlying boards, not one fixed host');
    } else {
      fail(`cross-host link drift: ${JSON.stringify(job)}`);
    }
  }
  if (normalizeJob({ title: '', link: 'https://example.com/x' }) === null) {
    pass('normalizeJob() drops an item with no title');
  } else {
    fail('a missing title must drop the item');
  }
  if (normalizeJob({ title: 'No Link Job', link: '' }) === null) {
    pass('normalizeJob() drops an item with no (or unparseable) link');
  } else {
    fail('a missing/invalid link must drop the item');
  }
  if (normalizeJob({ title: 'Bad Scheme', link: 'javascript:alert(1)' }) === null) {
    pass('normalizeJob() drops a non-http(s) link scheme');
  } else {
    fail('a non-http(s) link scheme must drop the item');
  }
  {
    const job = normalizeJob({ title: 'No Date Job', link: 'https://example.com/x', posted_ts: 0 });
    if (job && job.postedAt === undefined) {
      pass('normalizeJob() omits postedAt rather than inventing epoch-0 from posted_ts: 0');
    } else {
      fail(`zero posted_ts drift: ${JSON.stringify(job)}`);
    }
  }
  {
    const job = normalizeJob({ title: 'Minimal Job', link: 'https://example.com/x' });
    if (job && job.company === '' && job.location === '' && !('description' in job) && job.postedAt === undefined) {
      pass('normalizeJob() leaves optional fields empty/omitted rather than fabricating them');
    } else {
      fail(`minimal-item drift: ${JSON.stringify(job)}`);
    }
  }

  // ── fetch(): request shape sent to goodjobs' own API ──
  {
    /** @type {{url: string, opts: any}[]} */
    const calls = [];
    const ctx = {
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        return [{ title: 'Backend Engineer', link: 'https://itviec.com/it-jobs/x' }];
      },
    };
    const jobs = await goodjobs.fetch({ searchKeywords: 'backend' }, ctx);
    if (calls.length === 1 && calls[0].url === 'https://api.goodjobs.io.vn/scrape') {
      pass('fetch() posts to the resolved instance\'s /scrape endpoint');
    } else {
      fail(`request URL drift: ${JSON.stringify(calls.map((c) => c.url))}`);
    }
    const { opts } = calls[0];
    if (opts.method === 'POST' && opts.redirect === 'error' && opts.headers?.['Content-Type'] === 'application/json') {
      pass('fetch() sends POST, redirect:error, and a JSON content-type');
    } else {
      fail(`request options drift: ${JSON.stringify(opts)}`);
    }
    let parsedBody;
    try { parsedBody = JSON.parse(opts.body); } catch { /* leave undefined */ }
    if (parsedBody && parsedBody.keyword === 'backend' && parsedBody.location === 'Ho Chi Minh City' && parsedBody.country === 'VN') {
      pass('fetch() sends the built request body as JSON');
    } else {
      fail(`request body drift: ${opts.body}`);
    }
    if (jobs.length === 1 && jobs[0].title === 'Backend Engineer') {
      pass('fetch() returns normalized jobs from the response array');
    } else {
      fail(`fetch() result drift: ${JSON.stringify(jobs)}`);
    }
  }

  // fetch() must reject before ever calling the network when searchKeywords
  // is missing — a config error, not a wasted request against a rate-limited API.
  {
    let threw = false;
    let called = false;
    const ctx = { fetchJson: async () => { called = true; return []; } };
    try { await goodjobs.fetch({}, ctx); } catch { threw = true; }
    if (threw && !called) {
      pass('fetch() throws on a missing searchKeywords without calling the API');
    } else {
      fail(`missing-keyword handling drift: threw=${threw}, called=${called}`);
    }
  }

  // A response that isn't a JSON array must surface as an error, not silently
  // become zero jobs (e.g. goodjobs' own {"detail": "..."} error shape).
  {
    const ctx = { fetchJson: async () => ({ detail: 'keyword is required' }) };
    let threw = false;
    try { await goodjobs.fetch({ searchKeywords: 'backend' }, ctx); } catch { threw = true; }
    if (threw) pass('fetch() throws when the response is not a JSON array');
    else fail('a non-array response must throw, not be treated as an empty board');
  }

  // Items that fail normalization are dropped, not left half-populated.
  {
    const ctx = {
      fetchJson: async () => ([
        { title: 'Good Job', link: 'https://example.com/good' },
        { title: '', link: 'https://example.com/no-title' },
        { title: 'No Link' },
      ]),
    };
    const jobs = await goodjobs.fetch({ searchKeywords: 'backend' }, ctx);
    if (jobs.length === 1 && jobs[0].url === 'https://example.com/good') {
      pass('fetch() drops items that fail normalization');
    } else {
      fail(`filtering drift: ${JSON.stringify(jobs)}`);
    }
  }
} catch (error) {
  fail(`goodjobs provider tests could not run: ${error.message}`);
}
