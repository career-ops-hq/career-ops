// tests/providers/eploy.test.mjs — offline contract coverage for Eploy's
// public live-jobs sitemap and the two detail-page shapes observed live on
// 2026-09-09 (schema.org JSON-LD and legacy ASP.NET field markup).
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — eploy');

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/eploy.mjs')).href);
  const { resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const eploy = mod.default;

  if (eploy.id === 'eploy') pass('eploy.id is "eploy"');
  else fail(`eploy.id=${JSON.stringify(eploy.id)}`);

  const explicit = eploy.detect({
    name: 'Example employer', provider: 'eploy',
    careers_url: 'https://careers.example.com/vacancies/vacancy-search-results.aspx?view=list',
  });
  if (explicit?.url === 'https://careers.example.com/live-jobs.xml') {
    pass('detect resolves an explicit branded Eploy careers URL to live-jobs.xml');
  } else fail(`detect=${JSON.stringify(explicit)}`);

  const notExplicit = eploy.detect({ name: 'Untrusted lookalike', careers_url: 'https://eploy.example/jobs' });
  if (notExplicit === null) pass('detect is explicit-only for indistinguishable branded domains');
  else fail('detect claimed a branded domain without provider:eploy');

  const routed = resolveProvider(
    { name: 'Example employer', provider: 'eploy', careers_url: 'https://careers.example.com' },
    new Map([['eploy', eploy]]),
  );
  if (routed?.provider === eploy) pass('provider registry resolves explicit provider:eploy entries');
  else fail(`registry route=${JSON.stringify(routed)}`);

  for (const careers_url of [
    'http://careers.example.com/jobs',
    'https://127.0.0.1/jobs',
    'https://[::1]/jobs',
    'https://localhost/jobs',
    'https://jobs.internal/jobs',
    'https://singlelabel/jobs',
    'https://user:pass@careers.example.com/jobs',
    'https://careers.example.com:8443/jobs',
    'not a url',
  ]) {
    if (eploy.detect({ name: 'Bad', provider: 'eploy', careers_url }) === null) {
      pass(`detect rejects unsafe careers_url: ${careers_url}`);
    } else fail(`detect accepted unsafe careers_url: ${careers_url}`);
  }

  const origin = new URL('https://careers.example.com');
  const branded = mod.parseEploySitemap(fixture('eploy-live-jobs-branded.xml'), origin, 'Acme');
  if (branded.length === 2
      && branded[0].title === 'Learning And Development Advisor'
      && branded[1].title === 'HR And AI Specialist'
      && branded.every((job) => job.company === 'Acme' && job.location === '')
      && branded.every((job) => !('postedAt' in job))) {
    pass('parser normalizes branded sitemap URLs and does not mislabel lastmod as postedAt');
  } else fail(`branded parse=${JSON.stringify(branded)}`);

  const hosted = mod.parseEploySitemap(fixture('eploy-live-jobs-hosted.xml'), origin, 'Acme');
  if (hosted.length === 1
      && hosted[0].title === 'Implementation Consultant - HCM'
      && hosted[0].url === 'https://exampletenant.eploy.net/vacancies/201/implementation-consultant--hcm.html') {
    pass('parser permits canonical tenant.eploy.net links and drops unsafe/off-pattern loc values');
  } else fail(`hosted parse=${JSON.stringify(hosted)}`);

  const duplicateVacancy = mod.parseEploySitemap(`<?xml version="1.0"?>
    <urlset>
      <url><loc>https://careers.example.com/vacancies/301/learning-designer.html</loc></url>
      <url><loc>https://exampletenant.eploy.net/vacancies/301/learning-designer.html/</loc></url>
    </urlset>`, origin, 'Acme');
  if (duplicateVacancy.length === 1
      && duplicateVacancy[0].url === 'https://careers.example.com/vacancies/301/learning-designer.html') {
    pass('parser deduplicates one vacancy ID across branded and tenant hosts');
  } else fail(`duplicate vacancy parse=${JSON.stringify(duplicateVacancy)}`);

  if (mod.parseEploySitemap('', origin, 'Acme').length === 0
      && mod.parseEploySitemap('<?xml version="1.0"?><urlset></urlset>', origin, 'Acme').length === 0) {
    pass('empty body and valid empty urlset return []');
  } else fail('empty response handling failed');

  let malformedThrew = false;
  try { mod.parseEploySitemap('<html><body>Sign in</body></html>', origin, 'Acme'); }
  catch (err) { malformedThrew = /expected an XML urlset/i.test(err.message); }
  if (malformedThrew) pass('recognizable non-sitemap response throws descriptively');
  else fail('malformed response did not throw descriptively');

  const jsonLd = mod.parseEployDetail(fixture('eploy-detail-jsonld.html'));
  if (jsonLd.title === 'Implementation Consultant - HCM'
      && jsonLd.location === 'Watford, Hertfordshire, United Kingdom'
      && jsonLd.description === 'Deliver HR & payroll implementations.'
      && jsonLd.postedAt === Date.parse('2026-09-08')) {
    pass('detail parser reads schema.org JobPosting shape');
  } else fail(`JSON-LD detail=${JSON.stringify(jsonLd)}`);

  const legacy = mod.parseEployDetail(fixture('eploy-detail-legacy.html'));
  if (legacy.location === 'Manchester'
      && legacy.description === 'Support asset operations & client service.'
      && !('postedAt' in legacy)) {
    pass('detail parser reads legacy Eploy Web Forms field shape');
  } else fail(`legacy detail=${JSON.stringify(legacy)}`);

  if (Object.keys(mod.parseEployDetail('<script type="application/ld+json">oops</script>')).length === 2) {
    pass('malformed detail payload degrades to empty enrichment fields');
  } else fail('malformed detail payload handling changed');

  // Default scan: exactly one request, fixed feed path, redirect:error.
  const calls = [];
  const defaultJobs = await eploy.fetch(
    { name: 'Acme', provider: 'eploy', careers_url: 'https://careers.example.com/jobs' },
    { fetchText: async (url, opts) => { calls.push({ url, opts }); return fixture('eploy-live-jobs-branded.xml'); } },
  );
  if (defaultJobs.length === 2 && calls.length === 1
      && calls[0].url === 'https://careers.example.com/live-jobs.xml'
      && calls[0].opts?.redirect === 'error') {
    pass('default fetch makes one redirect-blocked sitemap request');
  } else fail(`default fetch calls=${JSON.stringify(calls)}, jobs=${defaultJobs.length}`);

  // Opt-in details are bounded, paced between batches, and fail open.
  const detailCalls = [];
  const sleeps = [];
  const enriched = await eploy.fetch(
    {
      name: 'Acme', provider: 'eploy', careers_url: 'https://careers.example.com/jobs',
      eploy: { fetchDetails: true, detailLimit: 2 },
    },
    {
      sleep: async (ms) => { sleeps.push(ms); },
      fetchText: async (url, opts) => {
        if (url.endsWith('/live-jobs.xml')) return fixture('eploy-live-jobs-branded.xml');
        detailCalls.push({ url, opts });
        if (url.includes('/102/')) throw new Error('HTTP 503');
        return fixture('eploy-detail-jsonld.html');
      },
    },
  );
  if (detailCalls.length === 4
      && detailCalls.every((call) => call.opts?.redirect === 'error')
      && enriched[0].location === 'Watford, Hertfordshire, United Kingdom'
      && enriched[1].title === 'HR And AI Specialist') {
    pass('opt-in details are bounded, redirect-safe, retry transient errors, and fail open per job');
  } else fail(`detail calls=${JSON.stringify(detailCalls)}, jobs=${JSON.stringify(enriched)}`);

  // A larger bounded set crosses a batch boundary and invokes the pacing hook.
  const fourRows = fixture('eploy-live-jobs-branded.xml').replace(
    '</urlset>',
    '<url><loc>https://careers.example.com/vacancies/103/qa-lead.html</loc></url><url><loc>https://careers.example.com/vacancies/104/ux-lead.html</loc></url></urlset>',
  );
  let fourDetailCalls = 0;
  const paced = [];
  await eploy.fetch(
    { name: 'Acme', provider: 'eploy', careers_url: 'https://careers.example.com', eploy: { fetchDetails: true, detailLimit: 4 } },
    {
      sleep: async (ms) => { paced.push(ms); },
      fetchText: async (url) => {
        if (url.endsWith('/live-jobs.xml')) return fourRows;
        fourDetailCalls++;
        return '';
      },
    },
  );
  if (fourDetailCalls === 4 && paced.includes(250)) pass('detail batches pace between requests groups');
  else fail(`detail pacing calls=${fourDetailCalls}, sleeps=${JSON.stringify(paced)}`);

  // Portal probes set ctx.maxPages. Eploy has a single inventory page, and
  // must skip all optional details while that bounded probe is active.
  let probeCalls = 0;
  const probed = await eploy.fetch(
    { name: 'Acme', provider: 'eploy', careers_url: 'https://careers.example.com', eploy: { fetchDetails: true } },
    {
      maxPages: 1,
      fetchText: async () => { probeCalls++; return fixture('eploy-live-jobs-branded.xml'); },
    },
  );
  if (probeCalls === 1 && probed.length === 2 && probed.every((job) => !job.description)) {
    pass('ctx.maxPages probe stays on the single inventory request and skips details');
  } else fail(`probe calls=${probeCalls}, jobs=${JSON.stringify(probed)}`);

  let unsafeFetchCalls = 0;
  for (const careers_url of ['http://careers.example.com', 'https://169.254.169.254/jobs', 'https://jobs.internal']) {
    let rejected = false;
    try {
      await eploy.fetch(
        { name: 'Bad', provider: 'eploy', careers_url },
        { fetchText: async () => { unsafeFetchCalls++; return ''; } },
      );
    } catch { rejected = true; }
    if (rejected) pass(`fetch rejects unsafe config before I/O: ${careers_url}`);
    else fail(`fetch accepted unsafe config: ${careers_url}`);
  }
  if (unsafeFetchCalls === 0) pass('SSRF config guards run before fetchText');
  else fail(`unsafe configs caused ${unsafeFetchCalls} fetchText call(s)`);
} catch (err) {
  fail(`eploy provider tests crashed: ${err.stack || err.message}`);
}
