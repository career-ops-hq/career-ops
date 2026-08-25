// tests/providers/wttj.test.mjs — Welcome to the Jungle provider (public
// Algolia search index behind welcometothejungle.com; credentials fetched
// fresh from /api/env). Follows the discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — wttj (Welcome to the Jungle Algolia index)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/wttj.mjs')).href);
  const wttj = mod.default;
  const { parseEnvPayload, normalizeWttjHit } = mod;

  if (wttj.id === 'wttj') pass('wttj.id is "wttj"');
  else fail(`wttj.id is ${JSON.stringify(wttj.id)}`);

  const hit = wttj.detect({ name: 'Welcome to the Jungle', provider: 'wttj' });
  if (hit && hit.url === 'https://www.welcometothejungle.com') {
    pass('wttj.detect() claims entries with provider: wttj');
  } else {
    fail(`wttj.detect() returned ${JSON.stringify(hit)}`);
  }

  if (wttj.detect({ name: 'X', provider: 'greenhouse' }) === null) {
    pass('wttj.detect() returns null for other providers');
  } else {
    fail('wttj.detect() should return null for other providers');
  }

  if (wttj.detect({ name: 'X', careers_url: 'https://www.welcometothejungle.com/en/jobs' }) === null) {
    pass('wttj.detect() does not URL-autodetect (explicit provider: wttj only — the board is global)');
  } else {
    fail('wttj.detect() should not claim entries by careers_url');
  }

  // parseEnvPayload — the /api/env `window.env = {...}` payload
  const HEX_KEY = '0123456789abcdef0123456789abcdef';
  const envText = (appId, apiKey) =>
    `window.env = ${JSON.stringify({ PUBLIC_ALGOLIA_APPLICATION_ID: appId, PUBLIC_ALGOLIA_API_KEY_CLIENT: apiKey, OTHER: 'noise' })};`;

  const creds = parseEnvPayload(envText(' AB12CD34 ', HEX_KEY));
  if (creds.appId === 'AB12CD34' && creds.apiKey === HEX_KEY) {
    pass('parseEnvPayload() extracts and trims the Algolia app id + client key');
  } else {
    fail(`parseEnvPayload() returned ${JSON.stringify(creds)}`);
  }

  // The client key is only ever sent as a header, so its format is not
  // over-constrained — a rotated long/base64 (secured) key must still parse.
  const securedKey = 'QWxnb2xpYSBzZWN1cmVkIGtleQ==' + 'x'.repeat(100);
  const secured = parseEnvPayload(envText('AB12CD34', securedKey));
  if (secured.apiKey === securedKey) {
    pass('parseEnvPayload() accepts a long non-hex (secured/base64) client key — length bounds only');
  } else {
    fail(`parseEnvPayload() secured key → ${JSON.stringify(secured.apiKey)}`);
  }

  const throws = (fn) => { try { fn(); return false; } catch { return true; } };

  if (throws(() => parseEnvPayload(envText('AB12CD34', 'short')))) {
    pass('parseEnvPayload() rejects an implausibly short api key');
  } else {
    fail('parseEnvPayload() should reject an implausibly short api key');
  }

  if (throws(() => parseEnvPayload(envText('bad app id!', HEX_KEY)))) {
    pass('parseEnvPayload() rejects a non-alphanumeric app id (it becomes a hostname)');
  } else {
    fail('parseEnvPayload() should reject a non-alphanumeric app id');
  }

  if (throws(() => parseEnvPayload('window.env = undefined;'))) {
    pass('parseEnvPayload() rejects a payload with no JSON object');
  } else {
    fail('parseEnvPayload() should reject a payload with no JSON object');
  }

  if (throws(() => parseEnvPayload('window.env = {not json};'))) {
    pass('parseEnvPayload() rejects invalid JSON');
  } else {
    fail('parseEnvPayload() should reject invalid JSON');
  }

  // normalizeWttjHit — Algolia hit → normalized Job
  const fullHit = {
    name: '  Senior Data Engineer  ',
    slug: 'senior-data-engineer_abc123',
    organization: { name: 'Example SAS', slug: 'example-sas' },
    offices: [{ city: 'Paris', country: 'France' }, { city: 'Lyon', country: 'France' }],
    remote: 'fulltime',
    published_at_timestamp: 1751500800,
    salary_yearly_minimum: 60000,
    salary_maximum: 80000,
    salary_period: 'yearly',
    salary_currency: 'eur',
  };
  const j1 = normalizeWttjHit(fullHit);
  if (
    j1 &&
    j1.title === 'Senior Data Engineer' &&
    j1.url === 'https://www.welcometothejungle.com/en/companies/example-sas/jobs/senior-data-engineer_abc123' &&
    j1.company === 'Example SAS'
  ) {
    pass('normalizeWttjHit() maps name/slug/organization to title/url/company');
  } else {
    fail(`normalizeWttjHit() job = ${JSON.stringify(j1)}`);
  }

  if (j1 && j1.location === 'Paris, France, Remote') {
    pass('normalizeWttjHit() joins first-office city+country and appends Remote for fulltime-remote posts');
  } else {
    fail(`normalizeWttjHit() location = ${JSON.stringify(j1 && j1.location)}`);
  }

  if (j1 && j1.postedAt === 1751500800000) {
    pass('normalizeWttjHit() converts published_at_timestamp epoch-seconds to ms');
  } else {
    fail(`normalizeWttjHit() postedAt = ${j1 && j1.postedAt}`);
  }

  if (j1 && j1.salary && j1.salary.min === 60000 && j1.salary.max === 80000 && j1.salary.currency === 'EUR') {
    pass('normalizeWttjHit() attaches a yearly salary range with uppercased currency');
  } else {
    fail(`normalizeWttjHit() salary = ${JSON.stringify(j1 && j1.salary)}`);
  }

  const monthly = normalizeWttjHit({
    ...fullHit,
    salary_yearly_minimum: 50000,
    salary_maximum: 5000,
    salary_period: 'monthly',
  });
  if (monthly && monthly.salary && monthly.salary.min === 50000 && monthly.salary.max === 50000) {
    pass('normalizeWttjHit() ignores a non-yearly salary_maximum (keeps only the annualized minimum)');
  } else {
    fail(`normalizeWttjHit() monthly-period salary = ${JSON.stringify(monthly && monthly.salary)}`);
  }

  const bare = normalizeWttjHit({ name: 'Job', slug: 'job-1', organization: { slug: 'acme' } });
  if (bare && bare.company === 'Welcome to the Jungle' && bare.location === '' && bare.salary === undefined && bare.postedAt === undefined) {
    pass('normalizeWttjHit() falls back to the board name and omits absent salary/postedAt');
  } else {
    fail(`normalizeWttjHit() bare hit = ${JSON.stringify(bare)}`);
  }

  if (normalizeWttjHit({ name: 'Job', slug: 'job-1', organization: {} }) === null) {
    pass('normalizeWttjHit() returns null when the organization slug is missing');
  } else {
    fail('normalizeWttjHit() should return null without an organization slug');
  }

  if (normalizeWttjHit({ name: 'Job', slug: '../evil', organization: { slug: 'acme' } }) === null) {
    pass('normalizeWttjHit() rejects path-unsafe slugs (they feed straight into a URL path)');
  } else {
    fail('normalizeWttjHit() should reject path-unsafe slugs');
  }

  if (normalizeWttjHit(null) === null && normalizeWttjHit('nope') === null) {
    pass('normalizeWttjHit() returns null for non-object hits');
  } else {
    fail('normalizeWttjHit() should return null for non-object hits');
  }

  // fetch() — env bootstrap, per-query Algolia calls, headers, dedup (mocked ctx)
  const ENV_OK = envText('AB12CD34', HEX_KEY);
  const mkHit = (slug, title) => ({
    name: title,
    slug,
    organization: { name: 'Acme', slug: 'acme' },
    offices: [{ city: 'Paris', country: 'France' }],
  });
  const mkCtx = (env, hitsFor) => {
    const textCalls = [];
    const jsonCalls = [];
    return {
      textCalls,
      jsonCalls,
      ctx: {
        fetchText: async (url, opts) => { textCalls.push({ url, opts }); return env; },
        fetchJson: async (url, opts) => {
          const params = new URLSearchParams(JSON.parse(opts.body).params);
          const call = { url, opts, query: params.get('query'), hitsPerPage: params.get('hitsPerPage') };
          jsonCalls.push(call);
          return hitsFor(call);
        },
      },
    };
  };

  const happy = mkCtx(ENV_OK, ({ query }) => ({
    hits: query === 'finops'
      ? [mkHit('job-a', 'FinOps Lead'), mkHit('job-b', 'FinOps Analyst')]
      : [mkHit('job-b', 'FinOps Analyst'), mkHit('job-c', 'Snowflake Engineer')],
  }));
  const happyJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { queries: ['finops', 'snowflake'] } },
    happy.ctx,
  );
  if (happyJobs.length === 3 && happy.jsonCalls.length === 2) {
    pass('wttj.fetch() runs one Algolia query per configured search and dedupes across queries');
  } else {
    fail(`wttj.fetch(): ${happyJobs.length} jobs from ${happy.jsonCalls.length} queries`);
  }

  if (
    happy.textCalls.length === 1 &&
    happy.textCalls[0].url === 'https://www.welcometothejungle.com/api/env' &&
    happy.textCalls[0].opts.redirect === 'error'
  ) {
    pass('wttj.fetch() bootstraps credentials from /api/env with redirect: error');
  } else {
    fail(`wttj.fetch() env calls = ${JSON.stringify(happy.textCalls.map((c) => c.url))}`);
  }

  const q1 = happy.jsonCalls[0];
  if (q1.url === 'https://AB12CD34-dsn.algolia.net/1/indexes/wttj_jobs_production_en/query') {
    pass('wttj.fetch() derives the Algolia host from the fetched app id');
  } else {
    fail(`wttj.fetch() Algolia URL = ${q1.url}`);
  }

  if (
    q1.opts.headers['x-algolia-application-id'] === 'AB12CD34' &&
    q1.opts.headers['x-algolia-api-key'] === HEX_KEY &&
    q1.opts.headers.referer === 'https://www.welcometothejungle.com/' &&
    q1.opts.redirect === 'error'
  ) {
    pass('wttj.fetch() sends the app id, api key, and the referer the key is locked to');
  } else {
    fail(`wttj.fetch() Algolia headers = ${JSON.stringify(q1.opts.headers)}`);
  }

  if (q1.hitsPerPage === '100' && happy.jsonCalls.map((c) => c.query).join(',') === 'finops,snowflake') {
    pass('wttj.fetch() defaults to 100 hits per query and passes each search term through');
  } else {
    fail(`wttj.fetch() hitsPerPage=${q1.hitsPerPage}, queries=${happy.jsonCalls.map((c) => c.query).join(',')}`);
  }

  const capped = mkCtx(ENV_OK, () => ({ hits: [] }));
  await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 500 } }, capped.ctx);
  if (capped.jsonCalls[0].hitsPerPage === '200') {
    pass('wttj.fetch() caps max_hits at 200 per query');
  } else {
    fail(`wttj.fetch() max_hits=500 → hitsPerPage=${capped.jsonCalls[0].hitsPerPage}`);
  }

  let noQueriesErr = '';
  try {
    await wttj.fetch({ name: 'WTTJ', provider: 'wttj' }, mkCtx(ENV_OK, () => ({ hits: [] })).ctx);
  } catch (err) { noQueriesErr = err.message; }
  // Assert the message, not just that something threw — an unrelated crash must not pass.
  if (noQueriesErr.includes('wttj: the WTTJ board is global')) {
    pass('wttj.fetch() throws without an explicit wttj.queries config (never scans the whole board)');
  } else {
    fail(`wttj.fetch() missing-queries error = ${JSON.stringify(noQueriesErr) || 'did not throw'}`);
  }

  let badShapeErr = '';
  try {
    await wttj.fetch(
      { name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'] } },
      mkCtx(ENV_OK, () => ({ error: 'nope' })).ctx,
    );
  } catch (err) { badShapeErr = err.message; }
  if (badShapeErr.includes('wttj: unexpected Algolia response') && badShapeErr.includes('expected { hits: [...] }')) {
    pass('wttj.fetch() throws on an Algolia response without a hits array');
  } else {
    fail(`wttj.fetch() malformed-response error = ${JSON.stringify(badShapeErr) || 'did not throw'}`);
  }
} catch (e) {
  fail(`wttj provider tests crashed: ${e.message}`);
}
