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

  // Normalized shape: { title, url, company, location }, plus postedAt when the
  // row carries a parseable `date` (row 0 does, row 1 has none).
  if (fetched[0] && Object.keys(fetched[0]).sort().join(',') === 'company,location,postedAt,title,url'
      && fetched[1] && Object.keys(fetched[1]).sort().join(',') === 'company,location,title,url')
    pass('remoteok.fetch() returns { title, url, company, location } and postedAt only when dated');
  else fail(`remoteok.fetch() keys = ${JSON.stringify(fetched.map((j) => Object.keys(j)))}`);

  if (fetched[0]?.postedAt === Date.UTC(2026, 6, 1))
    pass('remoteok.fetch() reads `date` into postedAt (epoch ms)');
  else fail(`remoteok.fetch() row 0 postedAt = ${JSON.stringify(fetched[0]?.postedAt)}`);

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

  // description: every row of the feed carries the posting's HTML. Dropped, it
  // left content_filter, country_eligibility_filter and visa_filter nothing to
  // read for any RemoteOK posting, and the scan-history fingerprint empty.
  const row = (slug, description) => ({ position: 'Data Engineer', company: 'Acme', url: `https://remoteok.com/remote-jobs/${slug}`, description });
  const described = await remoteok.fetch({ provider: 'remoteok' }, { fetchJson: async () => [
    { last_updated: 1751500000 },
    row('d1', '<p style="min-height:1.5em">You will write <strong>Python</strong> &amp; dbt.</p>'),
    row('d2'), row('d3', ''), row('d4', '   '), row('d5', null), row('d6', 42), row('d7', '<p></p>'),
  ] });
  if (described[0]?.description === 'You will write Python & dbt.')
    pass('remoteok.fetch() passes the description through as plain text');
  else fail(`remoteok.fetch() description = ${JSON.stringify(described[0]?.description)}`);
  if (described.length === 7 && described.slice(1).every((j) => !('description' in j)))
    pass('remoteok.fetch() omits description when it is absent, empty, whitespace, non-string or markup-only');
  else fail(`remoteok.fetch() description presence = ${JSON.stringify(described.map((j) => j.description))}`);

  const misread = (text) => Buffer.from(text, 'utf8').toString('latin1');
  const [repaired, plain, invalid] = await remoteok.fetch({}, { fetchJson: async () => [
    { ...row('mojibake', misread('<p>Join our team as a\u00a0<strong>Data Engineer</strong> today.</p>')),
      position: misread('Engineer – Platform'), company: misread('ŌURA'), location: misread('München') },
    row('plain', '<p>Already correct: München, café, 東京.</p>'),
    row('invalid', '<p>Keep Â§ in this café.</p>'),
  ] });
  if (repaired?.description === 'Join our team as a Data Engineer today.'
      && repaired.title === 'Engineer – Platform' && repaired.company === 'ŌURA' && repaired.location === 'München')
    pass('remoteok repairs Latin-1 misread feed text before stripping HTML');
  else fail(`remoteok encoding repair: ${JSON.stringify(repaired)}`);
  if (plain?.description === 'Already correct: München, café, 東京.'
      && invalid?.description === 'Keep Â§ in this café.')
    pass('remoteok preserves correct Unicode and values that fail strict UTF-8 decoding');
  else fail(`remoteok corrupted untouched text: ${JSON.stringify([plain, invalid])}`);

  // salary: USD per year; the feed gives 0 when the poster gave none.
  const paid = (min, max) => ({ position: 'Data Engineer', company: 'Acme', url: `https://remoteok.com/remote-jobs/p-${min}-${max}`, salary_min: min, salary_max: max });
  const salaried = await remoteok.fetch({}, { fetchJson: async () => [
    { last_updated: 1751500000 }, paid(90000, 120000), paid(0, 0), paid(80000, 0), paid(0, 150000), paid('x', null),
  ] });
  if (JSON.stringify(salaried[0]?.salary) === JSON.stringify({ min: 90000, max: 120000, currency: 'USD', period: 'year', posted: { min: 90000, max: 120000 } }))
    pass('remoteok.fetch() sets salary from salary_min and salary_max (USD per year)');
  else fail(`remoteok.fetch() salary = ${JSON.stringify(salaried[0]?.salary)}`);
  if (salaried[2]?.salary?.min === 80000 && salaried[2].salary.max === 80000 && !('max' in salaried[2].salary.posted)
      && salaried[3]?.salary?.min === 150000 && salaried[3].salary.max === 150000 && !('min' in salaried[3].salary.posted))
    pass('remoteok.fetch() fills a one-sided range from the other bound and keeps the posted bounds one-sided');
  else fail(`remoteok.fetch() one-sided salary = ${JSON.stringify([salaried[2]?.salary, salaried[3]?.salary])}`);
  if (!('salary' in salaried[1]) && !('salary' in salaried[4]))
    pass('remoteok.fetch() sets no salary for 0 or non-numeric bounds');
  else fail(`remoteok.fetch() empty salary = ${JSON.stringify([salaried[1]?.salary, salaried[4]?.salary])}`);

  // Only a number or a numeric string is a bound: a boolean, array or object is no value.
  const malformed = await remoteok.fetch({}, { fetchJson: async () => [
    { last_updated: 1751500000 },
    ...[[true, false], [[5], {}], [{ valueOf() { throw new Error('boom'); } }, Symbol('x')], ['90000', '120000']]
      .map(([min, max], i) => ({ ...paid(0, 0), url: `https://remoteok.com/remote-jobs/m${i}`, salary_min: min, salary_max: max })),
  ] });
  if (malformed.length === 4 && [0, 1, 2].every((i) => !('salary' in malformed[i])) && malformed[3].salary?.min === 90000 && malformed[3].salary.max === 120000)
    pass('remoteok.fetch() reads no salary from boolean, array or object bounds, never throws, and reads numeric strings');
  else fail(`remoteok.fetch() malformed salary = ${JSON.stringify(malformed.map((j) => j.salary))}`);

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
