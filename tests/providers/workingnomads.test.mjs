// tests/providers/workingnomads.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workingnomads');

try {
  const workingnomadsModule = await import(pathToFileURL(join(ROOT, 'providers/workingnomads.mjs')).href);
  const workingnomads = workingnomadsModule.default;

  if (workingnomads.id === 'workingnomads') pass('workingnomads.id is "workingnomads"');
  else fail(`workingnomads.id is ${JSON.stringify(workingnomads.id)}`);

  if (typeof workingnomads.fetch === 'function') pass('workingnomads exports a fetch() function');
  else fail('workingnomads.fetch should be a function');

  // Deterministic sample payload (top-level array) — no network. Two valid jobs
  // plus two that must be dropped (empty title, non-absolute url). Row 0 carries
  // surrounding whitespace on every field to verify trimming.
  const sample = [
    {
      title: 'Senior AI Engineer',
      url: 'https://www.workingnomads.com/jobs/acme-senior-ai-engineer',
      company_name: '  Acme Corp  ',                 // surrounding space → trimmed
      location: '  Remote (Worldwide)  ',            // surrounding space → trimmed
    },
    {
      title: '  Platform Engineer  ',              // leading/trailing space → trimmed
      url: '  https://www.workingnomads.com/jobs/beta-platform-engineer  ',
      company_name: '',                            // empty → falls back to entry.name
      // location omitted → ''
    },
    {
      title: '',                                    // dropped: empty title
      url: 'https://www.workingnomads.com/jobs/bad-empty-title',
      company_name: 'Bad Co',
    },
    {
      title: 'Relative URL Role',                   // dropped: non-absolute url
      url: '/jobs/relative',
      company_name: 'Rel Co',
    },
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await workingnomads.fetch(
    { name: 'Working Nomads Board', provider: 'workingnomads' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://www.workingnomads.com/api/exposed_jobs/')
    pass('workingnomads.fetch() requests the board-wide feed URL');
  else fail(`workingnomads.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('workingnomads.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  else fail(`workingnomads.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('workingnomads.fetch() keeps 2 valid jobs (drops empty-title + non-absolute-url rows)');
  else fail(`workingnomads.fetch() returned ${fetched.length} jobs (expected 2)`);

  // Normalized shape: exactly { title, url, company, location }.
  if (fetched[0] && Object.keys(fetched[0]).sort().join(',') === 'company,location,title,url')
    pass('workingnomads.fetch() returns the normalized { title, url, company, location } shape');
  else fail(`workingnomads.fetch() row 0 keys = ${JSON.stringify(fetched[0] && Object.keys(fetched[0]))}`);

  if (fetched[0]?.title === 'Senior AI Engineer'
      && fetched[0]?.url === 'https://www.workingnomads.com/jobs/acme-senior-ai-engineer'
      && fetched[0]?.company === 'Acme Corp'
      && fetched[0]?.location === 'Remote (Worldwide)')
    pass('workingnomads.fetch() maps title/url and trims company_name + location into the normalized shape');
  else fail(`workingnomads.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.title === 'Platform Engineer'
      && fetched[1]?.url === 'https://www.workingnomads.com/jobs/beta-platform-engineer')
    pass('workingnomads.fetch() trims whitespace from title and url');
  else fail(`workingnomads.fetch() row 1 title/url = ${JSON.stringify({ title: fetched[1]?.title, url: fetched[1]?.url })}`);

  if (fetched[1]?.company === 'Working Nomads Board')
    pass('workingnomads.fetch() falls back to entry.name when company_name is empty');
  else fail(`workingnomads.fetch() row 1 company = ${JSON.stringify(fetched[1]?.company)}`);

  if (fetched[1]?.location === '')
    pass('workingnomads.fetch() yields empty location when location is absent');
  else fail(`workingnomads.fetch() row 1 location = ${JSON.stringify(fetched[1]?.location)}`);

  // company default when both company_name and entry.name are missing → 'Working Nomads'.
  const noName = await workingnomads.fetch(
    {},
    { fetchJson: async () => ([{ title: 'Role', url: 'https://www.workingnomads.com/jobs/x' }]) },
  );
  if (noName[0]?.company === 'Working Nomads')
    pass('workingnomads.fetch() defaults company to "Working Nomads" when company_name and entry.name are both missing');
  else fail(`workingnomads.fetch() default company = ${JSON.stringify(noName[0]?.company)}`);

  // Empty-feed safety: an empty array yields an empty result (no crash).
  const empty = await workingnomads.fetch({ name: 'X' }, { fetchJson: async () => ([]) });
  if (Array.isArray(empty) && empty.length === 0) pass('workingnomads.fetch() returns [] for an empty feed');
  else fail(`workingnomads.fetch() empty feed = ${JSON.stringify(empty)}`);

  // Malformed (non-array) response → throws.
  let badResponseThrew = false;
  try {
    await workingnomads.fetch(
      { name: 'X', provider: 'workingnomads' },
      { fetchJson: async () => ({ jobs: [] }) },
    );
  } catch (e) {
    badResponseThrew = /unexpected API response/.test(e.message);
  }
  if (badResponseThrew) pass('workingnomads.fetch() throws on a non-array API response');
  else fail('workingnomads.fetch() should throw when the response is not an array');

} catch (e) {
  fail(`workingnomads provider tests crashed: ${e.message}`);
}

