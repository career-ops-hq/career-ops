// tests/providers/inhire.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — inhire');

try {
  const inhireModule = await import(pathToFileURL(join(ROOT, 'providers/inhire.mjs')).href);
  const inhire = inhireModule.default;
  const { parseInhireResponse, resolveInhireTenant } = inhireModule;
  const { isOfferSeen, markOfferSeen, listingIdentityToken } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const entry = { name: 'Acme', careers_url: 'https://acme.inhire.app' };
  // The list shape InHire returns (fictional tenant and ids).
  const page = (rows) => ({ tenantName: 'Acme Ltda', about: '<p>About</p>', jobsPage: rows });
  const row = (id, title, extra = {}) => ({
    careerPageId: 'default', careerPageIds: ['default'], displayName: title, jobId: id,
    status: 'published', workplaceType: 'Hybrid', location: 'São Paulo, SP, BR', ...extra,
  });
  /** A ctx whose fetchJson records every call and answers with `reply(url, opts)`. */
  function makeCtx(reply, extra = {}) {
    const calls = [];
    return {
      calls,
      ctx: {
        ...extra,
        fetchJson: async (url, opts) => { calls.push({ url, opts }); return reply(url, opts); },
        fetchText: async () => { throw new Error('fetchText must not be called'); },
      },
    };
  }

  if (inhire.id === 'inhire') pass('inhire.id is "inhire"');
  else fail(`inhire.id is ${JSON.stringify(inhire.id)}`);

  // ── detect() ──
  const detectCases = [
    ['https://acme.inhire.app', 'https://acme.inhire.app'],
    ['https://acme.inhire.app/vagas/1234/analista', 'https://acme.inhire.app'],
    ['https://acme-brasil.inhire.app/?utm=x', 'https://acme-brasil.inhire.app'],
  ];
  for (const [url, want] of detectCases) {
    const hit = inhire.detect({ name: 'Acme', careers_url: url });
    if (hit?.url === want) pass(`inhire.detect() claims ${url}`);
    else fail(`inhire.detect(${url}) returned ${JSON.stringify(hit)}`);
  }
  const apiHit = inhire.detect({ name: 'Acme', api: 'https://acme.inhire.app' });
  if (apiHit?.url === 'https://acme.inhire.app') pass('inhire.detect() honours an explicit api: URL');
  else fail(`inhire.detect() api: returned ${JSON.stringify(apiHit)}`);

  const rejected = [
    ['non-https', 'http://acme.inhire.app'],
    ['other host', 'https://example.com/careers'],
    ['inhire.app in the path', 'https://evil.example/acme.inhire.app'],
    ['suffix spoof', 'https://acme.inhire.app.evil.example'],
    ['prefix spoof', 'https://evilinhire.app'],
    ['InHire API host', 'https://api.inhire.app/job-posts/public/pages'],
    ['InHire marketing host', 'https://www.inhire.app'],
    ['bare inhire.app', 'https://inhire.app'],
    ['malformed', 'https://'],
    ['null', null],
    ['number', 7],
    ['missing', undefined],
  ];
  for (const [label, url] of rejected) {
    let hit;
    try {
      hit = inhire.detect({ name: 'X', careers_url: url });
    } catch (e) {
      fail(`inhire.detect() threw on ${label}: ${e.message}`);
      continue;
    }
    if (hit === null) pass(`inhire.detect() returns null for ${label}`);
    else fail(`inhire.detect() should return null for ${label}, got ${JSON.stringify(hit)}`);
  }

  // ── fetch(): normalization, header, redirect ──
  {
    const { calls, ctx } = makeCtx(() => page([
      row('7c1f0a2e-0000-4000-8000-000000000001', '  [Vendas] Consultor Sênior  ', { workplaceType: 'On-site' }),
      row('7c1f0a2e-0000-4000-8000-000000000002', 'Analista de Dados', { workplaceType: 'Remote', location: 'Remoto' }),
      row('7c1f0a2e-0000-4000-8000-000000000003', 'Engenheira de Software', { workplaceType: 'Unspecified' }),
    ]));
    const jobs = await inhire.fetch(entry, ctx);

    if (calls.length === 1 && calls[0].url === 'https://api.inhire.app/job-posts/public/pages') pass('inhire.fetch() makes one list request to the fixed API URL');
    else fail(`inhire.fetch() calls: ${JSON.stringify(calls.map(c => c.url))}`);
    if (calls[0]?.opts?.headers?.['X-Tenant'] === 'acme') pass('inhire.fetch() sends the tenant in X-Tenant');
    else fail(`inhire.fetch() headers: ${JSON.stringify(calls[0]?.opts?.headers)}`);
    if (calls.every(c => c.opts?.redirect === 'error')) pass("inhire.fetch() passes redirect: 'error'");
    else fail(`inhire.fetch() redirect: ${JSON.stringify(calls.map(c => c.opts?.redirect))}`);

    const [a, b, c] = jobs;
    if (jobs.length === 3) pass('inhire.fetch() returns every published row');
    else fail(`inhire.fetch() returned ${jobs.length} jobs`);
    if (a?.title === '[Vendas] Consultor Sênior') pass('inhire title is trimmed');
    else fail(`inhire title = ${JSON.stringify(a?.title)}`);
    if (a?.url === 'https://acme.inhire.app/vagas/7c1f0a2e-0000-4000-8000-000000000001/vendas-consultor-senior') pass('inhire url is <tenant>.inhire.app/vagas/<jobId>/<slug>');
    else fail(`inhire url = ${a?.url}`);
    if (a?.company === 'Acme' && a?.location === 'São Paulo, SP, BR') pass('inhire company comes from the entry, location from the row');
    else fail(`inhire company/location = ${a?.company} / ${a?.location}`);
    if (a?.workplaceType === 'onsite' && b?.workplaceType === 'remote' && c && !('workplaceType' in c)) pass('inhire workplaceType maps On-site/Remote and omits unknown values');
    else fail(`inhire workplaceType = ${a?.workplaceType} / ${b?.workplaceType} / ${c?.workplaceType}`);
    if (!jobs.some(j => 'postedAt' in j || 'description' in j)) pass('inhire list-only: no postedAt or description');
    else fail('inhire should not set postedAt/description from the list');
  }

  // ── rows the parser drops ──
  {
    const jobs = parseInhireResponse(page([
      row('id-ok', 'Kept'),
      row('id-draft', 'Draft', { status: 'draft' }),
      row('id-nostatus', 'No status', { status: undefined }),
      row('id-blank', '   '),
      row('', 'Empty id'),
      row(undefined, 'No id'),
      row(42, 'Numeric id'),
      null,
      'not an object',
    ]), 'Acme', 'acme');
    if (jobs.length === 1 && jobs[0].title === 'Kept') pass('parseInhireResponse drops unpublished, untitled, id-less and non-object rows');
    else fail(`parseInhireResponse kept ${JSON.stringify(jobs.map(j => j.title))}`);
  }

  // ── empty vs broken ──
  {
    const empty = await inhire.fetch(entry, makeCtx(() => page([])).ctx);
    if (Array.isArray(empty) && empty.length === 0) pass('inhire.fetch() returns [] for a live tenant with jobsPage: []');
    else fail(`inhire.fetch() empty board returned ${JSON.stringify(empty)}`);

    for (const [label, body] of [
      ['missing jobsPage', { tenantName: 'Acme' }],
      ['jobsPage as object', { jobsPage: {} }],
      ['null body', null],
      ['string body', 'oops'],
    ]) {
      try {
        await inhire.fetch(entry, makeCtx(() => body).ctx);
        fail(`inhire.fetch() should throw on ${label}`);
      } catch (e) {
        if (/unexpected response .*expected jobsPage\[\]/.test(e.message)) pass(`inhire.fetch() throws a descriptive error on ${label}`);
        else fail(`inhire.fetch() ${label} threw ${e.message}`);
      }
    }
  }

  // ── 404 unknown tenant, other errors unwrapped ──
  {
    const notFound = Object.assign(new Error('HTTP 404'), { status: 404 });
    try {
      await inhire.fetch(entry, makeCtx(() => { throw notFound; }).ctx);
      fail('inhire.fetch() should throw on 404');
    } catch (e) {
      if (e.status === 404 && /tenant "acme" not found/.test(e.message)) pass('inhire.fetch() turns 404 into a named error that keeps status 404');
      else fail(`inhire.fetch() 404 threw ${e.message} (status ${e.status})`);
    }

    const serverError = Object.assign(new Error('HTTP 503'), { status: 503 });
    try {
      await inhire.fetch(entry, makeCtx(() => { throw serverError; }).ctx);
      fail('inhire.fetch() should throw on 503');
    } catch (e) {
      if (e === serverError) pass('inhire.fetch() rethrows other HTTP errors unwrapped');
      else fail(`inhire.fetch() 503 threw a different error: ${e.message}`);
    }
  }

  // ── guard runs before any request ──
  for (const [label, bad] of [
    ['untrusted host', { name: 'X', careers_url: 'https://evil.example/acme.inhire.app' }],
    ['InHire API host', { name: 'X', careers_url: 'https://api.inhire.app' }],
    ['non-https', { name: 'X', careers_url: 'http://acme.inhire.app' }],
  ]) {
    const { calls, ctx } = makeCtx(() => { fail(`inhire.fetch() reached fetchJson for ${label}`); return page([]); });
    try {
      await inhire.fetch(bad, ctx);
      fail(`inhire.fetch() should throw for ${label}`);
    } catch (e) {
      if (calls.length === 0 && /cannot derive tenant/.test(e.message)) pass(`inhire.fetch() rejects ${label} before any request`);
      else fail(`inhire.fetch() ${label}: ${calls.length} calls, ${e.message}`);
    }
  }
  if (resolveInhireTenant({ careers_url: 'https://acme.inhire.app:8443/x' }) === 'acme') pass('resolveInhireTenant keeps only the hostname (port and path discarded)');
  else fail('resolveInhireTenant should read only the hostname');

  // ── health probe ──
  {
    const { calls, ctx } = makeCtx(() => page([row('id-1', 'One')]), { maxPages: 1 });
    await inhire.fetch(entry, ctx);
    if (calls.length === 1) pass('inhire.fetch() under ctx.maxPages: 1 makes exactly one list request');
    else fail(`inhire.fetch() probe made ${calls.length} requests`);

    const budget = new Error('probe budget reached');
    try {
      await inhire.fetch(entry, makeCtx(() => { throw budget; }, { maxPages: 1 }).ctx);
      fail('inhire.fetch() should propagate a probe rejection');
    } catch (e) {
      if (e === budget) pass('inhire.fetch() propagates a ctx.fetchJson rejection unwrapped while probing');
      else fail(`inhire.fetch() rewrapped the probe rejection: ${e.message}`);
    }
  }

  // ── listingIdentity ──
  {
    const fetchJobs = (rows) => inhire.fetch(entry, makeCtx(() => page(rows)).ctx);
    const [first] = await fetchJobs([row('7c1f0a2e-0000-4000-8000-00000000000a', 'Analista de Dados')]);
    const identity = first?.listingIdentity;
    if (identity?.ats_provider === 'inhire' && identity?.board_slug === 'acme'
        && identity?.posting_id === '7c1f0a2e-0000-4000-8000-00000000000a' && Object.keys(identity).length === 3) {
      pass('inhire.fetch() returns the inhire/<tenant>/<jobId> listingIdentity');
    } else {
      fail(`inhire identity = ${JSON.stringify(identity)}`);
    }

    // The URL slug follows the title: a retitled posting is a new URL for the
    // same jobId. URL dedup alone would count it twice; the identity does not.
    const [retitled] = await fetchJobs([row('7c1f0a2e-0000-4000-8000-00000000000a', 'Analista de Dados Sênior')]);
    const seen = new Set();
    markOfferSeen(first, seen);
    if (retitled.url !== first.url && isOfferSeen(retitled, seen)) pass('a retitled inhire posting (new slug, same jobId) is already seen');
    else fail(`retitled url ${retitled.url} seen=${isOfferSeen(retitled, seen)}`);

    const [other] = await fetchJobs([row('7c1f0a2e-0000-4000-8000-00000000000b', 'Analista de Dados')]);
    if (listingIdentityToken(other) && listingIdentityToken(other) !== listingIdentityToken(first) && !isOfferSeen(other, seen)) {
      pass('a different inhire jobId on the same tenant is a different listing');
    } else {
      fail(`other token = ${listingIdentityToken(other)}`);
    }

    const [padded] = await fetchJobs([row(' 7c1f0a2e-0000-4000-8000-00000000000c ', 'Padded id')]);
    if (padded && !('listingIdentity' in padded)) pass('a padded inhire jobId leaves listingIdentity off');
    else fail(`padded-id row = ${JSON.stringify(padded)}`);
  }
} catch (e) {
  fail(`inhire provider tests crashed: ${e.message}`);
}
