// tests/providers/remoteok.test.mjs — direct provider-contract tests (#1499).
// RemoteOK is a board-wide aggregator feed: no detect(), a fixed FEED_URL, and
// an API quirk — index 0 of the returned array is a {last_updated, legal}
// metadata object, not a job. These tests pin the id/fetch contract that
// scan.mjs relies on, with a deterministic mock ctx (no network).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — remoteok');

try {
  const remoteokModule = await import(pathToFileURL(join(ROOT, 'providers/remoteok.mjs')).href);
  const remoteok = remoteokModule.default;

  if (remoteok.id === 'remoteok') pass('remoteok.id is "remoteok"');
  else fail(`remoteok.id is ${JSON.stringify(remoteok.id)}`);

  // Board-wide feed: no detect() — wired in explicitly via `provider: remoteok`.
  if (remoteok.detect === undefined && typeof remoteok.fetch === 'function') {
    pass('remoteok exposes fetch() only (no detect — explicit provider: wiring)');
  } else {
    fail(`remoteok surface: detect=${typeof remoteok.detect}, fetch=${typeof remoteok.fetch}`);
  }

  // Deterministic sample payload mirroring the real feed shape: metadata object
  // at index 0, then job rows keyed by `position` (not `title`).
  const sample = [
    { last_updated: 1751500000, legal: 'API terms...' },                 // metadata row — must be dropped
    {
      slug: 'acme-staff-ai-engineer',
      position: 'Staff AI Engineer',
      company: 'Acme Corp',
      location: 'Worldwide',
      url: 'https://remoteok.com/remote-jobs/acme-staff-ai-engineer',
      date: '2026-07-01T00:00:00+00:00',
    },
    {
      position: '  Platform Engineer  ',                                 // whitespace → trimmed
      company: '   ',                                                    // whitespace-only → falls back to entry.name
      location: null,                                                    // non-string → ''
      url: '  https://remoteok.com/remote-jobs/beta-platform-engineer  ',
    },
    null,                                                                // null row — must be skipped
    'not-an-object',                                                     // non-object row — must be skipped
    { position: '', url: 'https://remoteok.com/remote-jobs/empty' },     // empty position — skip
    { position: 'Relative URL Role', url: '/remote-jobs/relative' },     // non-absolute url — skip
    { position: 'No URL Role' },                                         // missing url — skip
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await remoteok.fetch(
    { name: 'RemoteOK Board', provider: 'remoteok' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://remoteok.com/api')
    pass('remoteok.fetch() requests the fixed board-wide feed URL');
  else fail(`remoteok.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('remoteok.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  else fail(`remoteok.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('remoteok.fetch() keeps 2 valid jobs (drops metadata row, null, non-object, empty-position, bad-url rows)');
  else fail(`remoteok.fetch() returned ${fetched.length} jobs (expected 2): ${JSON.stringify(fetched)}`);

  // Normalized shape: exactly { title, url, company, location }.
  if (fetched[0] && Object.keys(fetched[0]).sort().join(',') === 'company,location,title,url')
    pass('remoteok.fetch() returns the normalized { title, url, company, location } shape');
  else fail(`remoteok.fetch() row 0 keys = ${JSON.stringify(fetched[0] && Object.keys(fetched[0]))}`);

  if (fetched[0]?.title === 'Staff AI Engineer'
      && fetched[0]?.url === 'https://remoteok.com/remote-jobs/acme-staff-ai-engineer'
      && fetched[0]?.company === 'Acme Corp'
      && fetched[0]?.location === 'Worldwide')
    pass('remoteok.fetch() maps position/url/company/location for a full row');
  else fail(`remoteok.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.title === 'Platform Engineer'
      && fetched[1]?.url === 'https://remoteok.com/remote-jobs/beta-platform-engineer')
    pass('remoteok.fetch() trims whitespace from title and url');
  else fail(`remoteok.fetch() row 1 title/url = ${JSON.stringify({ title: fetched[1]?.title, url: fetched[1]?.url })}`);

  if (fetched[1]?.company === 'RemoteOK Board')
    pass('remoteok.fetch() falls back to entry.name when company is whitespace-only');
  else fail(`remoteok.fetch() row 1 company = ${JSON.stringify(fetched[1]?.company)}`);

  if (fetched[1]?.location === '')
    pass('remoteok.fetch() yields empty location for a non-string location value');
  else fail(`remoteok.fetch() row 1 location = ${JSON.stringify(fetched[1]?.location)}`);

  // company default when both the row's company and entry.name are missing → 'RemoteOK'.
  const noName = await remoteok.fetch(
    {},
    { fetchJson: async () => [{ position: 'Role', url: 'https://remoteok.com/remote-jobs/x' }] },
  );
  if (noName[0]?.company === 'RemoteOK')
    pass('remoteok.fetch() defaults company to "RemoteOK" when company and entry.name are both missing');
  else fail(`remoteok.fetch() default company = ${JSON.stringify(noName[0]?.company)}`);

  // Non-array API response → typed error, not a silent empty result.
  let badResponseThrew = false;
  try {
    await remoteok.fetch(
      { name: 'X', provider: 'remoteok' },
      { fetchJson: async () => ({ jobs: [] }) },
    );
  } catch (e) {
    badResponseThrew = /unexpected API response/.test(e.message);
  }
  if (badResponseThrew) pass('remoteok.fetch() throws on a non-array API response');
  else fail('remoteok.fetch() should throw when the response is not an array');

  // null response → the error message must say "null", not "object".
  let nullResponseMsg = '';
  try {
    await remoteok.fetch({ name: 'X' }, { fetchJson: async () => null });
  } catch (e) {
    nullResponseMsg = e.message;
  }
  if (/unexpected API response/.test(nullResponseMsg) && /got null/.test(nullResponseMsg))
    pass('remoteok.fetch() reports "null" (not "object") for a null API response');
  else fail(`remoteok.fetch() null-response error = ${JSON.stringify(nullResponseMsg)}`);

} catch (e) {
  fail(`remoteok provider tests crashed: ${e.message}`);
}
