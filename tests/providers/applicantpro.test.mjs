// tests/providers/applicantpro.test.mjs — offline contract coverage for the
// ApplicantPro / isolved Talent Acquisition provider. Fictional tenant
// `acme-example` and fictional postings only (tests/fixtures/applicantpro-*).
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — applicantpro');

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
const ORIGIN = 'https://acme-example.applicantpro.com';
const listJson = () => JSON.parse(fixture('applicantpro-core-jobs.json'));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/applicantpro.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'applicantpro') pass('applicantpro.id is "applicantpro"');
  else fail(`wrong provider id ${provider.id}`);

  // ── detect(): <tenant>.applicantpro.com, shallowest URL, host only trusted ──
  for (const [label, url] of [
    ['tenant root', 'https://acme-example.applicantpro.com'],
    ['tenant root with slash', 'https://acme-example.applicantpro.com/'],
    ['/jobs/ listing', 'https://acme-example.applicantpro.com/jobs/'],
    ['a posting page', 'https://acme-example.applicantpro.com/jobs/9000001.html'],
    ['a non-default port (dropped)', 'https://acme-example.applicantpro.com:8443/jobs/'],
    ['upper-case host', 'https://ACME-Example.ApplicantPro.com/'],
    ['sitemap-style www link', 'https://www.applicantpro.com/openings/acme-example/jobs/9000001'],
  ]) {
    const hit = provider.detect({ name: 'Acme', careers_url: url });
    if (hit?.url === `${ORIGIN}/jobs/`) pass(`detect resolves ${label}`);
    else fail(`detect did not resolve ${label}: ${JSON.stringify(hit)}`);
  }
  if (provider.detect({ name: 'Acme', api: `${ORIGIN}/jobs/`, careers_url: 'https://other.example/' })?.url === `${ORIGIN}/jobs/`) {
    pass('detect honours api: over careers_url');
  } else fail('detect ignored api:');

  for (const bad of [
    'http://acme-example.applicantpro.com/',
    'https://evil.example/',
    'https://acme-example.applicantpro.com.evil.example/',
    'https://acme-example.applicantpro.com@evil.example/',
    'https://evil.example/acme-example.applicantpro.com/',
    'https://acmeexample-applicantpro.com/',
    'https://evilapplicantpro.com/',
    'https://applicantpro.com/',
    'https://www.applicantpro.com/',
    'https://www.applicantpro.com/openings/',
    'https://www.applicantpro.com/openings/evil.example/jobs/1',
    'https://feeds.applicantpro.com/site_map_index.xml',
    'https://user:pw@acme-example.applicantpro.com/',
    'not a url',
    '',
    null,
    7,
  ]) {
    let hit;
    try { hit = provider.detect({ name: 'X', careers_url: bad }); } catch (e) { fail(`detect threw on ${String(bad)}: ${e.message}`); continue; }
    if (hit === null) pass(`detect rejects ${String(bad)}`);
    else fail(`detect accepted ${String(bad)}`);
  }
  for (const entry of [null, undefined, {}, 'x']) {
    let hit;
    try { hit = provider.detect(entry); } catch (e) { fail(`detect(${JSON.stringify(entry)}) threw: ${e.message}`); continue; }
    if (hit === null) pass(`detect(${JSON.stringify(entry)}) returns null`);
    else fail(`detect(${JSON.stringify(entry)}) claimed an entry`);
  }

  // ── extractDomainId(): the listing component's id, not the social widget's ──
  const page = fixture('applicantpro-jobs-page.html');
  if (mod.extractDomainId(page) === 70123) pass('extractDomainId reads the site id from the listing component');
  else fail(`extractDomainId=${mod.extractDomainId(page)}`);
  if (mod.extractDomainId('<script>{ rootDomainId : 4 }</script>') === null) pass('extractDomainId ignores rootDomainId');
  else fail('extractDomainId matched rootDomainId');
  if (mod.extractDomainId('<a href="/core/jobs/4321?x=1">') === 4321) pass('extractDomainId falls back to a literal /core/jobs/<id> path');
  else fail('extractDomainId missed the /core/jobs path');
  if (mod.extractDomainId('<html>nothing</html>') === null && mod.extractDomainId('') === null && mod.extractDomainId(null) === null) {
    pass('extractDomainId returns null when there is no id');
  } else fail('extractDomainId should return null without an id');

  // ── parseListResponse(): normalization, gotchas, malformed rows ──
  const jobs = mod.parseListResponse(listJson(), ORIGIN, 'Acme Example');
  if (jobs.length === 4 && jobs.map((j) => j.externalId).join() === '9000001,9000002,9000003,9000004') {
    pass('keeps the four well-formed postings; drops empty title, missing id, hostile id, duplicate id and null rows');
  } else fail(`unexpected rows: ${JSON.stringify(jobs.map((j) => j.externalId))}`);
  const [learning, ops, tech, payroll] = jobs;
  if (learning.title === 'Learning Coordinator'
      && learning.url === `${ORIGIN}/jobs/9000001`
      && learning.company === 'Acme Example'
      && learning.location === 'Springfield, IL, United States'
      && learning.postedAt === Date.UTC(2026, 8, 2)) pass('normalizes title, absolute url, company, location and a UTC postedAt');
  else fail(`learning row: ${JSON.stringify(learning)}`);
  if (learning.salary?.min === 48000 && learning.salary?.max === 50000 && !('currency' in learning.salary)) pass('attaches an annual pay range, no currency guessed');
  else fail(`learning salary: ${JSON.stringify(learning.salary)}`);
  if (!('salary' in ops) && !('salary' in tech) && !('salary' in payroll)) {
    pass('no salary for a missing range, an hourly range, or a 0/0 annual range');
  } else fail(`unexpected salary: ${JSON.stringify([ops.salary, tech.salary, payroll.salary])}`);
  if (ops.location === 'Shelbyville, IL') pass('builds a location from city + region when jobLocation is empty');
  else fail(`ops location=${ops.location}`);
  if (tech.title === 'Site Technician' && !('postedAt' in tech)) pass('collapses title whitespace; an unparseable date leaves postedAt off');
  else fail(`tech row: ${JSON.stringify(tech)}`);
  if (jobs.every((j) => !('requisitionId' in j) && !('description' in j) && !('employmentType' in j))) {
    pass('sets no requisitionId, description or employment type from the list');
  } else fail('list rows carry fields the payload does not back');

  // empty vs broken
  if (mod.parseListResponse({ success: true, data: { jobs: [], jobCount: 0 } }, ORIGIN, 'A').length === 0) pass('a present-and-empty data.jobs is an empty board');
  else fail('empty board did not return []');
  for (const [label, body] of [
    ['an empty object', {}],
    ['data.jobs null', { success: true, data: { jobs: null } }],
    ['data.jobs an object', { success: true, data: { jobs: {} } }],
    ['jobs under another key', { success: true, data: { results: [] } }],
    ['success false', { success: false, data: { jobs: [] } }],
    ['a bare string', 'Unable to process request properly.'],
    ['null', null],
  ]) {
    try {
      mod.parseListResponse(body, ORIGIN, 'A');
      fail(`${label} should throw`);
    } catch (e) {
      if (/^applicantpro: unexpected response/.test(e.message)) pass(`${label} throws a descriptive error`);
      else fail(`${label} threw the wrong error: ${e.message}`);
    }
  }

  // ── parseDetail(): JSON-LD gotchas ──
  const full = mod.parseDetail(fixture('applicantpro-detail-full.html'));
  if (full.title === 'Learning Coordinator'
      && /^Help build & run training for the Acme team\./.test(full.description)
      && /Schedule sessions/.test(full.description)
      && full.postedAt === Date.UTC(2026, 8, 2)
      && full.location === 'Springfield, IL') pass('parseDetail reads title, decoded description, posted date and location');
  else fail(`full detail: ${JSON.stringify(full)}`);
  const odd = mod.parseDetail(fixture('applicantpro-detail-odd.html'));
  if (odd.title === 'Operations Manager - Midwest' && !('employmentType' in odd) && !('validThrough' in odd) && !('salary' in odd)) {
    pass('parseDetail takes the JSON-LD title and ignores validThrough, employmentType and baseSalary');
  } else fail(`odd detail: ${JSON.stringify(odd)}`);
  if (Object.keys(mod.parseDetail('<html>no json-ld</html>')).length === 0
      && Object.keys(mod.parseDetail('<script type="application/ld+json">{not json</script>')).length === 0
      && Object.keys(mod.parseDetail(null)).length === 0) pass('parseDetail tolerates pages with no or broken JSON-LD');
  else fail('parseDetail should return {} for missing/broken JSON-LD');

  // ── fetch(): requests, redirect:error, probe, details, caches, errors ──
  const makeCtx = (over = {}) => {
    const calls = [];
    const delays = [];
    return {
      calls,
      delays,
      sleep: async (ms) => { delays.push(ms); },
      fetchText: async (url, opts) => {
        calls.push({ kind: 'text', url, opts });
        if (url === `${ORIGIN}/jobs/`) return page;
        if (url.endsWith('/9000001')) return fixture('applicantpro-detail-full.html');
        if (url.endsWith('/9000002')) return fixture('applicantpro-detail-odd.html');
        return '<html>no json-ld</html>';
      },
      fetchJson: async (url, opts) => {
        calls.push({ kind: 'json', url, opts });
        return listJson();
      },
      ...over,
    };
  };
  const entry = { name: 'Acme Example', careers_url: 'https://acme-example.applicantpro.com/' };

  const ctx = makeCtx();
  const fetched = await provider.fetch(entry, ctx);
  const listCall = ctx.calls.find((c) => c.kind === 'json');
  if (fetched.length === 4 && ctx.calls.length === 2
      && ctx.calls[0].url === `${ORIGIN}/jobs/`
      && listCall.url === `${ORIGIN}/core/jobs/70123?getParams=%7B%7D`) pass('default scan is two requests: the site id page, then one JSON list');
  else fail(`default fetch calls: ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
  if (ctx.calls.every((c) => c.opts?.redirect === 'error')) pass('every request passes redirect:"error"');
  else fail(`a request did not pass redirect:error: ${JSON.stringify(ctx.calls.map((c) => c.opts))}`);
  if (ctx.calls.every((c) => new URL(c.url).origin === ORIGIN)) pass('never requests the www sitemap redirect hosts, only the tenant origin');
  else fail('requested a host other than the tenant');
  if (fetched.every((j) => !('description' in j))) pass('no description without fetchDetails (no per-posting requests)');
  else fail('description set without opt-in');

  // www sitemap-style careers_url still scans the tenant host
  const wwwCtx = makeCtx();
  await provider.fetch({ name: 'Acme', careers_url: 'https://www.applicantpro.com/openings/acme-example/jobs/9000001' }, wwwCtx);
  if (wwwCtx.calls.every((c) => new URL(c.url).origin === ORIGIN)) pass('a www /openings/<tenant>/ link scans the tenant host');
  else fail('www link was requested directly');

  // pinned domainId skips the page request
  const pinCtx = makeCtx();
  await provider.fetch({ ...entry, applicantpro: { domainId: 555 } }, pinCtx);
  if (pinCtx.calls.length === 1 && pinCtx.calls[0].url === `${ORIGIN}/core/jobs/555?getParams=%7B%7D`) pass('applicantpro.domainId pins the site id (one request)');
  else fail(`pinned calls: ${JSON.stringify(pinCtx.calls.map((c) => c.url))}`);

  // idCache
  const memCache = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { values, get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  };
  const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  const hitCache = memCache({ 'acme-example.applicantpro.com': { id: 999, checkedAt: recent } });
  const hitCtx = makeCtx({ idCache: hitCache });
  await provider.fetch(entry, hitCtx);
  if (hitCtx.calls.length === 1 && hitCtx.calls[0].url === `${ORIGIN}/core/jobs/999?getParams=%7B%7D`) pass('a fresh cached site id skips the /jobs/ page');
  else fail(`cache hit calls: ${JSON.stringify(hitCtx.calls.map((c) => c.url))}`);
  const missCache = memCache();
  await provider.fetch(entry, makeCtx({ idCache: missCache }));
  if (missCache.values.get('acme-example.applicantpro.com')?.id === 70123) pass('a cache miss stores the resolved site id');
  else fail(`stored: ${JSON.stringify([...missCache.values])}`);
  const staleCache = memCache({ 'acme-example.applicantpro.com': { id: 999, checkedAt: old } });
  const staleCtx = makeCtx({ idCache: staleCache, fetchText: async () => '<html>reshaped</html>' });
  const stale = await provider.fetch(entry, staleCtx);
  if (stale.length === 4) pass('a stale cached id keeps working when the recheck page changed shape');
  else fail('stale cached id was not kept');
  const goneCache = memCache({ 'acme-example.applicantpro.com': { id: 999, checkedAt: old } });
  try {
    await provider.fetch(entry, makeCtx({ idCache: goneCache, fetchText: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); } }));
    fail('a 404 on the /jobs/ recheck should throw');
  } catch {
    if (!goneCache.values.has('acme-example.applicantpro.com')) pass('a 404 on the recheck drops the cached id and surfaces the error');
    else fail('cached id survived a 404');
  }

  // no site id on the page: a markup change is loud
  try {
    await provider.fetch(entry, makeCtx({ fetchText: async () => '<html>no id</html>' }));
    fail('a /jobs/ page with no site id should throw');
  } catch (e) {
    if (/could not find the site id/.test(e.message)) pass('a /jobs/ page without a site id throws');
    else fail(`wrong error: ${e.message}`);
  }
  // broken list envelope is loud
  try {
    await provider.fetch(entry, makeCtx({ fetchJson: async () => ({ success: true, data: {} }) }));
    fail('an envelope without data.jobs should throw');
  } catch (e) {
    if (/unexpected response/.test(e.message)) pass('fetch throws on an envelope without data.jobs');
    else fail(`wrong error: ${e.message}`);
  }
  // empty board
  const emptyJobs = await provider.fetch(entry, makeCtx({ fetchJson: async () => ({ success: true, data: { jobs: [], jobCount: 0 } }) }));
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0) pass('fetch returns [] for a tenant with no openings');
  else fail('empty tenant did not return []');

  // SSRF guard before any network call
  for (const bad of ['https://evil.example/jobs/', 'http://acme-example.applicantpro.com/', 'https://www.applicantpro.com/']) {
    let calls = 0;
    const guardCtx = { fetchText: async () => { calls++; return ''; }, fetchJson: async () => { calls++; return {}; } };
    try {
      await provider.fetch({ name: 'X', careers_url: bad }, guardCtx);
      fail(`fetch accepted ${bad}`);
    } catch {
      if (calls === 0) pass(`guard rejects ${bad} before any request`);
      else fail(`guard made ${calls} request(s) for ${bad}`);
    }
  }

  // incomplete list warning
  const warnings = [];
  const realError = console.error;
  console.error = (...a) => warnings.push(a.join(' '));
  try {
    const short = listJson();
    short.data.jobCount = 120;
    await provider.fetch(entry, makeCtx({ fetchJson: async () => short }));
  } finally { console.error = realError; }
  if (warnings.some((w) => /applicantpro: Acme Example returned 9 of 120/.test(w))) pass('warns when jobCount exceeds the rows returned');
  else fail(`no incomplete-list warning: ${JSON.stringify(warnings)}`);

  // ── fetchDetails ──
  const detailCtx = makeCtx();
  const enriched = await provider.fetch({ ...entry, applicantpro: { fetchDetails: true, detailLimit: 2 } }, detailCtx);
  const detailCalls = detailCtx.calls.filter((c) => c.kind === 'text' && c.url !== `${ORIGIN}/jobs/`);
  if (detailCalls.length === 2 && detailCalls.every((c) => c.opts?.redirect === 'error')
      && detailCalls[0].url === `${ORIGIN}/jobs/9000001` && detailCalls[1].url === `${ORIGIN}/jobs/9000002`) pass('fetchDetails fetches up to detailLimit posting pages with redirect:"error"');
  else fail(`detail calls: ${JSON.stringify(detailCalls.map((c) => c.url))}`);
  if (detailCtx.delays.length === 1 && detailCtx.delays[0] === 250) pass('detail requests are paced');
  else fail(`delays=${JSON.stringify(detailCtx.delays)}`);
  const [e1, e2, e3] = enriched;
  if (/Help build & run training/.test(e1.description || '') && e1.title === 'Learning Coordinator') pass('detail fills description');
  else fail(`e1=${JSON.stringify(e1)}`);
  if (e2.title === 'Operations Manager - Midwest' && /Permanent management role/.test(e2.description || '') && e2.location === 'Shelbyville, IL') {
    pass('the JSON-LD title wins; far-future validThrough and CONTRACTOR employmentType change nothing');
  } else fail(`e2=${JSON.stringify(e2)}`);
  if (!('description' in e3)) pass('postings past detailLimit stay list-only');
  else fail('detailLimit not honoured');

  // detailLimit caps however many postings exist
  const many = listJson();
  many.data.jobs = Array.from({ length: 40 }, (_, i) => ({ id: 9100000 + i, title: `Role ${i}`, jobLocation: 'X' }));
  many.data.jobCount = 40;
  const capCtx = makeCtx({ fetchJson: async () => many });
  await provider.fetch({ ...entry, applicantpro: { fetchDetails: true, detailLimit: 10 } }, capCtx);
  if (capCtx.calls.filter((c) => /\/jobs\/91\d+$/.test(c.url)).length === 10) pass('40 postings at detailLimit 10 make exactly 10 detail calls');
  else fail('detailLimit did not cap the detail calls');
  const defCtx = makeCtx({ fetchJson: async () => many });
  await provider.fetch({ ...entry, applicantpro: { fetchDetails: true } }, defCtx);
  if (defCtx.calls.filter((c) => /\/jobs\/91\d+$/.test(c.url)).length === 25) pass('detailLimit defaults to 25');
  else fail('default detailLimit wrong');
  const hugeCtx = makeCtx({ fetchJson: async () => ({ success: true, data: { jobs: Array.from({ length: 150 }, (_, i) => ({ id: 9200000 + i, title: `R${i}`, jobLocation: 'X' })), jobCount: 150 } }) });
  await provider.fetch({ ...entry, applicantpro: { fetchDetails: true, detailLimit: 5000 } }, hugeCtx);
  if (hugeCtx.calls.filter((c) => /\/jobs\/92\d+$/.test(c.url)).length === 100) pass('detailLimit is clamped to 100');
  else fail('detailLimit not clamped');

  // a failing detail fetch keeps the list row
  const failCtx = makeCtx({
    fetchText: async (url, opts) => {
      if (url === `${ORIGIN}/jobs/`) return page;
      throw Object.assign(new Error('HTTP 500'), { status: 500 });
    },
    sleep: async () => {},
  });
  const survived = await provider.fetch({ ...entry, applicantpro: { fetchDetails: true, detailLimit: 2 } }, failCtx);
  if (survived.length === 4 && survived[0].title === 'Learning Coordinator' && !('description' in survived[0])) pass('a failed detail fetch keeps the list row and does not fail the target');
  else fail('detail failure was not contained');

  // details off by default: no config, or fetchDetails not strictly true
  for (const cfg of [undefined, {}, { fetchDetails: 'yes' }, { detailLimit: 5 }]) {
    const c = makeCtx();
    await provider.fetch({ ...entry, ...(cfg ? { applicantpro: cfg } : {}) }, c);
    if (c.calls.length === 2) pass(`no detail requests for config ${JSON.stringify(cfg)}`);
    else fail(`unexpected detail requests for config ${JSON.stringify(cfg)}`);
  }

  // ── probe cooperation ──
  const probeCtx = makeCtx({ maxPages: 1 });
  await provider.fetch({ ...entry, applicantpro: { fetchDetails: true } }, probeCtx);
  if (probeCtx.calls.filter((c) => c.kind === 'json').length === 1 && probeCtx.calls.every((c) => c.url === `${ORIGIN}/jobs/` || c.kind === 'json')) {
    pass('probe: one list request and no detail requests');
  } else fail(`probe calls: ${JSON.stringify(probeCtx.calls.map((c) => c.url))}`);
  class Sentinel extends Error {}
  for (const [label, over] of [
    ['list', { fetchJson: async () => { throw new Sentinel('budget'); } }],
    ['site id page', { fetchText: async () => { throw new Sentinel('budget'); } }],
  ]) {
    try {
      await provider.fetch(entry, makeCtx({ maxPages: 1, ...over }));
      fail(`probe ${label} rejection was swallowed`);
    } catch (e) {
      if (e instanceof Sentinel) pass(`probe: a ${label} rejection propagates unwrapped`);
      else fail(`probe ${label} rejection was rewrapped: ${e.message}`);
    }
  }
} catch (e) { fail(`applicantpro provider tests crashed: ${e.stack || e.message}`); }
