// tests/providers/torre.test.mjs — Torre opportunity-search provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — torre');

try {
  const torreModule = await import(pathToFileURL(join(ROOT, 'providers/torre.mjs')).href);
  const torre = torreModule.default;
  const { buildTorreQuery, normalizeTorreOpportunity } = torreModule;

  if (torre.id === 'torre') pass('torre.id is "torre"');
  else fail(`torre.id is ${JSON.stringify(torre.id)}`);

  // -- Query construction: only filters proven to move `total` may be sent. --

  if (JSON.stringify(buildTorreQuery({})) === '{}')
    pass('buildTorreQuery() sends an empty body when nothing is configured');
  else fail(`buildTorreQuery({}) = ${JSON.stringify(buildTorreQuery({}))}`);

  // `experience` is a REQUIRED companion to skill/role.text — omitting it is a
  // hard HTTP 500 against the live API, so it must always be emitted.
  if (JSON.stringify(buildTorreQuery({ search: '  engineering manager  ' }))
      === '{"skill/role":{"text":"engineering manager","experience":"1-plus-year"}}')
    pass('buildTorreQuery() maps search: to skill/role, trims it, and pairs the required experience');
  else fail(`buildTorreQuery(search) = ${JSON.stringify(buildTorreQuery({ search: 'engineering manager' }))}`);

  const everPaired = ['a', 'kubernetes', 'x y z']
    .map((s) => buildTorreQuery({ search: s })['skill/role'])
    .every((f) => f && typeof f.experience === 'string' && f.experience);
  if (everPaired)
    pass('buildTorreQuery() never emits skill/role.text without an experience (live 500 guard)');
  else fail('buildTorreQuery() emitted a skill/role filter with no experience');

  if (JSON.stringify(buildTorreQuery({ search: 'x', experience: '3-plus-years' }))
      === '{"skill/role":{"text":"x","experience":"3-plus-years"}}')
    pass('buildTorreQuery() honours a configured experience level');
  else fail(`buildTorreQuery(experience) = ${JSON.stringify(buildTorreQuery({ search: 'x', experience: '3-plus-years' }))}`);

  let badExperienceThrew = false;
  try {
    buildTorreQuery({ search: 'x', experience: 'senior' });
  } catch (err) {
    badExperienceThrew = /invalid experience/.test(err.message);
  }
  if (badExperienceThrew)
    pass('buildTorreQuery() rejects an experience value the API would refuse');
  else fail('buildTorreQuery() should throw on an unknown experience value');

  if (JSON.stringify(buildTorreQuery({ experience: '3-plus-years' })) === '{}')
    pass('buildTorreQuery() ignores experience when no search is configured');
  else fail(`buildTorreQuery(experience only) = ${JSON.stringify(buildTorreQuery({ experience: '3-plus-years' }))}`);

  if (JSON.stringify(buildTorreQuery({ remote_only: true })) === '{"remote":{"term":true}}')
    pass('buildTorreQuery() adds the remote filter when remote_only is true');
  else fail(`buildTorreQuery(remote_only) = ${JSON.stringify(buildTorreQuery({ remote_only: true }))}`);

  // `{"remote":{"term":false}}` is not a verified filter — a falsy remote_only
  // must send no remote key rather than one the API may silently ignore.
  const notRemote = [
    buildTorreQuery({ remote_only: false }),
    buildTorreQuery({ remote_only: 'yes' }),
    buildTorreQuery({ remote_only: 0 }),
  ];
  if (notRemote.every((b) => !('remote' in b)))
    pass('buildTorreQuery() omits the remote key unless remote_only === true');
  else fail(`buildTorreQuery() emitted a remote key for a non-true value: ${JSON.stringify(notRemote)}`);

  if (!('objective' in buildTorreQuery({ search: 'x' })))
    pass('buildTorreQuery() never sends the silently-ignored objective filter');
  else fail('buildTorreQuery() must not send an objective filter (the API ignores it)');

  // -- Normalization --

  const sample = {
    results: [
      {
        id: 'NwBp2Axr',
        objective: '  Engineering Manager  ',
        status: 'open',
        remote: true,
        locations: ['Colombia', 'Uruguay'],
        created: '2026-08-06T17:48:17.000Z',
        organizations: [{ name: 'Torre.ai' }],
      },
      {
        id: 'Ab12cd34',
        objective: 'Staff Backend Engineer',
        status: 'open',
        remote: false,
        locations: ['Montevideo, Uruguay'],
        organizations: [{ name: '  ' }, { name: 'dLocal' }], // first org unnamed → next wins
      },
      { id: 'Cc44dd55', objective: 'Closed Role', status: 'closed', remote: true },     // dropped: not open
      { id: 'Ee66ff77', objective: '', status: 'open', remote: true },                  // dropped: no title
      { id: '', objective: 'No Id Role', status: 'open', remote: true },                // dropped: no id
      { id: '../../admin', objective: 'Path Injection', status: 'open' },               // dropped: bad id
    ],
  };

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await torre.fetch(
    { name: 'Torre Feed', provider: 'torre', search: 'engineering manager' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://search.torre.co/opportunities/_search?offset=0&size=20')
    pass('torre.fetch() requests the search endpoint at offset=0 with the 20-row cap');
  else fail(`torre.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.method === 'POST'
      && capturedOpts.headers?.['Content-Type'] === 'application/json'
      && capturedOpts.body === JSON.stringify({ 'skill/role': { text: 'engineering manager', experience: '1-plus-year' } }))
    pass('torre.fetch() POSTs the JSON query body');
  else fail(`torre.fetch() opts = ${JSON.stringify(capturedOpts)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('torre.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  else fail(`torre.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('torre.fetch() keeps 2 valid rows (drops closed, untitled, id-less and bad-id rows)');
  else fail(`torre.fetch() returned ${fetched.length} jobs (expected 2): ${JSON.stringify(fetched)}`);

  if (fetched[0]?.title === 'Engineering Manager'
      && fetched[0]?.url === 'https://torre.ai/post/NwBp2Axr'
      && fetched[0]?.company === 'Torre.ai')
    pass('torre.fetch() trims the title and builds the permalink from the id');
  else fail(`torre.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[0]?.location === 'Remote — Colombia, Uruguay')
    pass('torre.fetch() keeps the country list on a remote posting');
  else fail(`torre.fetch() row 0 location = ${JSON.stringify(fetched[0]?.location)}`);

  if (fetched[0]?.postedAt === Date.parse('2026-08-06T17:48:17.000Z'))
    pass('torre.fetch() maps created (ISO 8601) to postedAt in ms');
  else fail(`torre.fetch() row 0 postedAt = ${JSON.stringify(fetched[0]?.postedAt)}`);

  if (fetched[1]?.location === 'Montevideo, Uruguay' && fetched[1]?.company === 'dLocal')
    pass('torre.fetch() joins locations for a non-remote row and skips an unnamed org');
  else fail(`torre.fetch() row 1 = ${JSON.stringify(fetched[1])}`);

  if (fetched[1] && !('postedAt' in fetched[1]))
    pass('torre.fetch() omits postedAt when created is absent');
  else fail(`torre.fetch() row 1 postedAt = ${JSON.stringify(fetched[1]?.postedAt)}`);

  const noStatus = normalizeTorreOpportunity({ id: 'Zz99yy88', objective: 'Role', remote: true });
  if (noStatus && noStatus.url === 'https://torre.ai/post/Zz99yy88')
    pass('normalizeTorreOpportunity() treats an absent status as open');
  else fail(`normalizeTorreOpportunity(no status) = ${JSON.stringify(noStatus)}`);

  const noOrg = normalizeTorreOpportunity({ id: 'Qq11ww22', objective: 'Solo Role', status: 'open' });
  if (noOrg?.company === 'Torre')
    pass('normalizeTorreOpportunity() defaults company to "Torre" with no org and no entry name');
  else fail(`normalizeTorreOpportunity(no org) company = ${JSON.stringify(noOrg?.company)}`);

  // -- Error handling and the single-request contract --

  let badResponseThrew = false;
  try {
    await torre.fetch({ name: 'X' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (err) {
    badResponseThrew = /unexpected API response/.test(err.message);
  }
  if (badResponseThrew) pass('torre.fetch() throws on unexpected API response shape');
  else fail('torre.fetch() should throw when the results array is absent');

  const mkRow = (i) => ({ id: `Id${String(i).padStart(6, '0')}`, objective: `Role ${i}`, status: 'open', remote: true });
  const fullPage = { results: Array.from({ length: 20 }, (_, i) => mkRow(i)) };

  // The endpoint caps at 20 rows and ignores offset/page/from, so the provider
  // must issue exactly ONE request and never try to advance.
  const callUrls = [];
  const single = await torre.fetch(
    { name: 'T' },
    { fetchJson: async (url) => { callUrls.push(url); return fullPage; } },
  );
  if (callUrls.length === 1)
    pass('torre.fetch() issues exactly one request even on a full 20-row page');
  else fail(`torre.fetch() made ${callUrls.length} requests (expected 1): ${JSON.stringify(callUrls)}`);

  if (single.length === 20)
    pass('torre.fetch() returns the full 20-row page');
  else fail(`torre.fetch() returned ${single.length} rows (expected 20)`);

  // max_pages / ctx.maxPages must not resurrect a paging loop that cannot advance.
  const pagingHints = [];
  await torre.fetch(
    { name: 'T', max_pages: 10 },
    { maxPages: 5, fetchJson: async (url) => { pagingHints.push(url); return fullPage; } },
  );
  if (pagingHints.length === 1)
    pass('torre.fetch() stays at one request regardless of max_pages / ctx.maxPages');
  else fail(`torre.fetch() made ${pagingHints.length} requests with paging hints set`);

  const dupRow = mkRow(1);
  const deduped = await torre.fetch(
    { name: 'T' },
    { fetchJson: async () => ({ results: [dupRow, dupRow, mkRow(2)] }) },
  );
  if (deduped.length === 2)
    pass('torre.fetch() dedups a repeated opportunity within a page');
  else fail(`torre.fetch() dedup failed: ${JSON.stringify(deduped.map((j) => j.url))}`);

} catch (e) {
  fail(`torre provider tests crashed: ${e.message}`);
}
