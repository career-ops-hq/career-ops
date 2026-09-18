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
      ? pass('google.fetch() maps the slug to a title and keeps the public results URL')
      : fail(`google mapping: ${JSON.stringify(jobs)}`);

    calls.every((c) => c.opts?.redirect === 'error')
      ? pass('google.fetch() passes redirect:"error" on every recorded request')
      : fail(`google redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
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
