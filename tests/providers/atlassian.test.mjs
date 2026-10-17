// tests/providers/atlassian.test.mjs — atlassian provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — atlassian');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/atlassian.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'atlassian') pass('atlassian.id is "atlassian"');
  else fail(`atlassian.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', careers_url: 'https://www.atlassian.com/company/careers/all-jobs' });
  if (hit && hit.url) pass('atlassian.detect() resolves its careers host to an endpoint');
  else fail(`atlassian.detect() returned ${JSON.stringify(hit)}`);

  // The host must be compared exactly. A substring match would let
  // https://evil.example.com/www.atlassian.com/ and https://www.atlassian.com.evil.example.com/
  // both claim this provider and point the scanner at an attacker's server.
  const pathHijack = provider.detect({ name: 'X', careers_url: 'https://evil.example.com/www.atlassian.com/careers' });
  const suffixHijack = provider.detect({ name: 'X', careers_url: 'https://www.atlassian.com.evil.example.com/careers' });
  if (pathHijack === null && suffixHijack === null) {
    pass('atlassian.detect() compares the host exactly (path and suffix hijacks rejected)');
  } else {
    fail(`atlassian.detect() hijackable: path=${JSON.stringify(pathHijack)} suffix=${JSON.stringify(suffixHijack)}`);
  }

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('atlassian.detect() returns null for an unrelated host');
  } else {
    fail('atlassian.detect() should return null for an unrelated host');
  }

  if (provider.detect({ name: 'X', careers_url: null }) === null && provider.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('atlassian.detect() treats a non-string careers_url as missing');
  } else {
    fail('atlassian.detect() should treat a non-string careers_url as missing');
  }

  if (typeof provider.fetch === 'function') pass('atlassian.fetch() is callable');
  else fail('atlassian.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  // ── behaviour: drive fetch() against a realistic feed payload ─────────────
  const recordingCtx = (respond) => {
    const calls = [];
    const fetchJson = async (url, opts = {}) => { const call = { url, opts, n: calls.length }; calls.push(call); return respond(call); };
    return { calls, ctx: { transport: 'http', fetchJson, fetchText: async () => { throw new Error('atlassian must not call fetchText'); } } };
  };
  const ENTRY = { name: 'Atlassian', careers_url: 'https://www.atlassian.com/company/careers/all-jobs' };
  const LISTING = {
    id: 25583,
    title: 'Principal Strategy Manager',
    locations: ['San Francisco - United States -   San Francisco, California 94104 United States', 'Remote'],
    // The live feed's shapes (2026-09-24): both are iCIMS, the posting page and
    // its application form.
    applyUrl: 'https://globalcareers-atlassian.icims.com/jobs/25583/principal-strategy-manager/job?mode=apply',
    portalJobPost: { id: 25583, portalUrl: 'https://globalcareers-atlassian.icims.com/jobs/25583/principal-strategy-manager/job', updatedDate: '2026-09-11 01:00 AM' },
  };

  {
    const { ctx, calls } = recordingCtx(() => [LISTING]);
    const jobs = await provider.fetch(ENTRY, ctx);
    const j = jobs[0];
    jobs.length === 1
      && j.title === 'Principal Strategy Manager'
      && j.url === 'https://globalcareers-atlassian.icims.com/jobs/25583/principal-strategy-manager/job'
      && j.company === 'Atlassian'
      && j.location === 'San Francisco - United States - San Francisco, California 94104 United States; Remote'
      && j.externalId === '25583'
      ? pass('atlassian.fetch() maps title/url/company/collapsed location/externalId')
      : fail(`atlassian mapping: ${JSON.stringify(jobs)}`);

    'postedAt' in (j || {})
      ? fail(`atlassian set postedAt from an edit date: ${j.postedAt}`)
      : pass('atlassian.fetch() omits postedAt — the feed carries only a last-edited date');

    calls.length === 1 && calls[0].opts?.redirect === 'error'
      ? pass('atlassian.fetch() reads the whole board in one request with redirect:"error"')
      : fail(`atlassian requests: ${JSON.stringify(calls.map((c) => [c.url, c.opts]))}`);
  }

  // A feed that stops being an array is an API change, not an empty board.
  {
    const { ctx } = recordingCtx(() => ({ listings: [LISTING], total: 1 }));
    let msg = '';
    await provider.fetch(ENTRY, ctx).catch((e) => { msg = e.message; });
    /did not return an array/.test(msg) && /listings/.test(msg)
      ? pass('atlassian.fetch() throws and names the keys it got when the feed shape changes')
      : fail(`atlassian shape error was ${JSON.stringify(msg)}`);
  }

  // An empty board is a legitimate answer and must stay quiet.
  {
    const { ctx } = recordingCtx(() => []);
    const jobs = await provider.fetch(ENTRY, ctx);
    Array.isArray(jobs) && jobs.length === 0
      ? pass('atlassian.fetch() returns [] for an empty feed without throwing')
      : fail(`atlassian empty feed: ${JSON.stringify(jobs)}`);
  }

  // The posting page wins over the application form; the form is only the
  // fallback for a row that carries no posting page.
  {
    const { ctx } = recordingCtx(() => [{ ...LISTING, id: 9, portalJobPost: { id: 9 } }]);
    const jobs = await provider.fetch(ENTRY, ctx);
    jobs[0]?.url === LISTING.applyUrl
      ? pass('atlassian.fetch() falls back to applyUrl when the row has no posting page')
      : fail(`atlassian url fallback: ${jobs[0]?.url}`);
  }

  // Rows missing the fields the scanner contract requires are dropped, not
  // emitted with empty strings.
  {
    const { ctx } = recordingCtx(() => [
      { ...LISTING, title: '' },
      { ...LISTING, id: 2, applyUrl: '', portalJobPost: { id: 2 } },
      { ...LISTING, id: 3, applyUrl: 'https://jobs.atlassian.com/job/3', title: 'Kept' },
    ]);
    const jobs = await provider.fetch(ENTRY, ctx);
    jobs.length === 1 && jobs[0].title === 'Kept'
      ? pass('atlassian.fetch() drops rows with no title or no apply URL')
      : fail(`atlassian row filter: ${JSON.stringify(jobs)}`);
  }

} catch (e) {
  fail(`atlassian provider tests crashed: ${e.message}`);
}
