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

  if (torre.detect({ provider: 'torre' })?.url === 'https://search.torre.co/opportunities/_search' && torre.detect({ name: 'X' }) === null)
    pass('torre.detect() matches only an explicit provider: torre');
  else fail('torre.detect() should match only provider: torre');

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

  const noStatus = normalizeTorreOpportunity({ id: 'Zz99yy88', objective: 'Role', remote: true });
  if (noStatus && noStatus.url === 'https://torre.ai/post/Zz99yy88')
    pass('normalizeTorreOpportunity() treats an absent status as open');
  else fail(`normalizeTorreOpportunity(no status) = ${JSON.stringify(noStatus)}`);

  const noOrg = normalizeTorreOpportunity({ id: 'Qq11ww22', objective: 'Solo Role', status: 'open' });
  if (noOrg?.company === 'Torre')
    pass('normalizeTorreOpportunity() defaults company to "Torre" with no org and no entry name');
  else fail(`normalizeTorreOpportunity(no org) company = ${JSON.stringify(noOrg?.company)}`);

  // -- Retirement (#4859): fetch() throws without touching the network. --

  let networkCalls = 0;
  let fetchErr = null;
  try {
    await torre.fetch(
      { name: 'Torre - cybersecurity', provider: 'torre', search: 'cybersecurity' },
      { fetchJson: async () => { networkCalls++; return { results: [] }; } },
    );
  } catch (err) {
    fetchErr = err;
  }
  if (networkCalls === 0 && fetchErr
      && /torre: this source is unavailable/.test(fetchErr.message)
      && /HTTP 400/.test(fetchErr.message)
      && /#4859/.test(fetchErr.message)
      && /remove `provider: torre`/.test(fetchErr.message))
    pass('torre.fetch() throws a "source unavailable" message naming the cause (#4859) without touching the network');
  else fail(`torre.fetch() should throw a retirement message with zero network calls, got: networkCalls=${networkCalls}, error=${fetchErr ? fetchErr.message : '(did not throw)'}`);

} catch (e) {
  fail(`torre provider tests crashed: ${e.message}`);
}
