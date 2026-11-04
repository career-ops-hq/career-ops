// tests/providers/remotive.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — remotive');


try {
  const remotiveModule = await import(pathToFileURL(join(ROOT, 'providers/remotive.mjs')).href);
  const remotive = remotiveModule.default;

  if (remotive.id === 'remotive') pass('remotive.id is "remotive"');
  else fail(`remotive.id is ${JSON.stringify(remotive.id)}`);

  // Deterministic sample payload — no network. Two valid jobs plus two that must
  // be dropped by the filter (empty title, non-absolute url).
  const sample = {
    jobs: [
      {
        title: 'Staff AI Engineer',
        url: 'https://remotive.com/remote-jobs/acme-staff-ai-engineer',
        company_name: 'Acme Corp',
        candidate_required_location: 'Worldwide',
        publication_date: '2026-10-27T12:56:13',             // no offset → read as UTC
      },
      {
        title: '  Platform Engineer  ',                 // leading/trailing space → trimmed
        url: '  https://remotive.com/remote-jobs/beta-platform-engineer  ',
        company_name: '',                               // empty → falls back to entry.name
        // candidate_required_location omitted → location ''
        publication_date: 'not a date',                // unparseable → no postedAt
      },
      {
        title: '',                                       // dropped: empty title
        url: 'https://remotive.com/remote-jobs/bad-empty-title',
        company_name: 'Bad Co',
      },
      {
        title: 'Relative URL Role',                      // dropped: non-absolute url
        url: '/remote-jobs/relative',
        company_name: 'Rel Co',
      },
    ],
  };

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await remotive.fetch(
    { name: 'Remotive Board', provider: 'remotive' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://remotive.com/api/remote-jobs')
    pass('remotive.fetch() requests the board-wide feed URL');
  else fail(`remotive.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('remotive.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  else fail(`remotive.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('remotive.fetch() keeps 2 valid jobs (drops empty-title + non-absolute-url rows)');
  else fail(`remotive.fetch() returned ${fetched.length} jobs (expected 2)`);

  // Normalized shape: { title, url, company, location }, plus postedAt when the
  // row carries a parseable `publication_date` (row 0 does, row 1's is junk).
  if (fetched[0] && Object.keys(fetched[0]).sort().join(',') === 'company,location,postedAt,title,url'
      && fetched[1] && Object.keys(fetched[1]).sort().join(',') === 'company,location,title,url')
    pass('remotive.fetch() returns { title, url, company, location } and postedAt only when dated');
  else fail(`remotive.fetch() keys = ${JSON.stringify(fetched.map((j) => Object.keys(j)))}`);

  const { toEpochMs } = await import(pathToFileURL(join(ROOT, 'providers/remotive.mjs')).href);
  if (toEpochMs('2026-10-27T12:56:13Z') === Date.UTC(2026, 9, 27, 12, 56, 13)
      && toEpochMs('2026-10-27T12:56:13+02:00') === Date.UTC(2026, 9, 27, 10, 56, 13)
      && toEpochMs('2026-10-27') === Date.UTC(2026, 9, 27)
      && toEpochMs('') === undefined && toEpochMs(null) === undefined && toEpochMs('soon') === undefined)
    pass('remotive toEpochMs keeps an explicit offset, reads a bare date as UTC, rejects junk');
  else fail('remotive toEpochMs mishandles an offset, a bare date or junk');

  if (fetched[0]?.postedAt === Date.UTC(2026, 9, 27, 12, 56, 13))
    pass('remotive.fetch() reads `publication_date` into postedAt (epoch ms)');
  else fail(`remotive.fetch() row 0 postedAt = ${JSON.stringify(fetched[0]?.postedAt)}`);

  if (fetched[0]?.title === 'Staff AI Engineer'
      && fetched[0]?.url === 'https://remotive.com/remote-jobs/acme-staff-ai-engineer'
      && fetched[0]?.company === 'Acme Corp'
      && fetched[0]?.location === 'Worldwide')
    pass('remotive.fetch() maps title/url/company_name/candidate_required_location for a full row');
  else fail(`remotive.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.title === 'Platform Engineer'
      && fetched[1]?.url === 'https://remotive.com/remote-jobs/beta-platform-engineer')
    pass('remotive.fetch() trims whitespace from title and url');
  else fail(`remotive.fetch() row 1 title/url = ${JSON.stringify({ title: fetched[1]?.title, url: fetched[1]?.url })}`);

  if (fetched[1]?.company === 'Remotive Board')
    pass('remotive.fetch() falls back to entry.name when company_name is empty');
  else fail(`remotive.fetch() row 1 company = ${JSON.stringify(fetched[1]?.company)}`);

  if (fetched[1]?.location === '')
    pass('remotive.fetch() yields empty location when candidate_required_location is absent');
  else fail(`remotive.fetch() row 1 location = ${JSON.stringify(fetched[1]?.location)}`);

  // company default when both company_name and entry.name are missing → 'Remotive'.
  const noName = await remotive.fetch(
    {},
    { fetchJson: async () => ({ jobs: [{ title: 'Role', url: 'https://remotive.com/remote-jobs/x' }] }) },
  );
  if (noName[0]?.company === 'Remotive')
    pass('remotive.fetch() defaults company to "Remotive" when company_name and entry.name are both missing');
  else fail(`remotive.fetch() default company = ${JSON.stringify(noName[0]?.company)}`);

  let badResponseThrew = false;
  try {
    await remotive.fetch(
      { name: 'X', provider: 'remotive' },
      { fetchJson: async () => ({ wrong: true }) },
    );
  } catch (e) {
    badResponseThrew = /unexpected API response/.test(e.message);
  }
  if (badResponseThrew) pass('remotive.fetch() throws on unexpected API response shape');
  else fail('remotive.fetch() should throw when the jobs array is absent');

} catch (e) {
  fail(`remotive provider tests crashed: ${e.message}`);
}

