// tests/providers/getro.test.mjs — direct provider-contract tests (PR #825).
// Getro boards are addressed by a numeric collection id that is interpolated
// straight into the API URL, so detect() must reject any non-numeric value.
// Also covers the redirect:'error' guard, the pagination bound, and
// malformed-payload tolerance.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — getro');

try {
  const getro = (await import(pathToFileURL(join(ROOT, 'providers/getro.mjs')).href)).default;

  if (getro.id === 'getro') pass('getro.id is "getro"');
  else fail(`getro.id is ${JSON.stringify(getro.id)}`);

  const getHit = getro.detect({ name: 'b2v', getro_collection: 4283 });
  if (getHit && getHit.url === 'https://api.getro.com/api/v2/collections/4283/search/jobs') pass('getro.detect() claims a numeric collection');
  else fail(`getro.detect() returned ${JSON.stringify(getHit)}`);

  // Injection-ish / non-numeric collection ids are rejected (URL is built from this).
  let getroRejected = true;
  for (const bad of ['abc', '4283; DROP', '../evil', '4283/../../x', '']) {
    if (getro.detect({ name: 'X', getro_collection: bad }) !== null) {
      fail(`getro.detect() should reject non-numeric collection: ${JSON.stringify(bad)}`);
      getroRejected = false;
    }
  }
  if (getroRejected) pass('getro.detect() rejects non-numeric collection ids');

  // fetch() passes redirect:'error'.
  let getroOpts = null;
  const getroJobs = await getro.fetch({ name: 'b2v', getro_collection: 4283 }, {
    fetchJson: async (_url, opts) => {
      getroOpts = opts;
      // No created_at → undated job is kept ("missing = pass"), so this test is
      // robust against the rolling 90-day pagination cutoff.
      return { results: { count: 1, jobs: [{ title: 'Principal', url: 'https://jobs.b2venture.vc/x', organization: { name: 'Acme' }, locations: ['Zurich'] }] } };
    },
  });
  if (getroOpts?.redirect === 'error') pass('getro.fetch() passes redirect:"error"');
  else fail(`getro.fetch() should pass redirect:"error", got ${JSON.stringify(getroOpts)}`);
  if (getroJobs.length === 1 && getroJobs[0].company === 'Acme') pass('getro.fetch() normalizes a job row');
  else fail(`getro.fetch() row = ${JSON.stringify(getroJobs[0])}`);

  // created_at arrives as Unix seconds; postedAt must be milliseconds.
  const getroDated = await getro.fetch({ name: 'b2v', getro_collection: 4283 }, {
    fetchJson: async () => ({
      results: { count: 1, jobs: [{ title: 'Recent', url: 'https://jobs.b2venture.vc/y', organization: { name: 'Acme' }, created_at: 1_900_000_000 }] },
    }),
  });
  if (getroDated[0]?.postedAt === 1_900_000_000_000) pass('getro.fetch() converts created_at Unix seconds to epoch ms');
  else fail(`getro.fetch() postedAt = ${JSON.stringify(getroDated[0]?.postedAt)}`);

  // A pagination override must not let a board drive unbounded requests.
  let getroPages = 0;
  await getro.fetch({ name: 'b2v', getro_collection: 4283, getro_max_pages: 10_000 }, {
    fetchJson: async () => {
      getroPages++;
      if (getroPages > 200) throw new Error('getro paginated past any sane bound');
      return { results: { count: 1_000_000, jobs: [{ title: 'T', url: `https://jobs.b2venture.vc/${getroPages}`, organization: { name: 'Acme' } }] } };
    },
  });
  if (getroPages <= 200) pass(`getro.fetch() clamps an oversized getro_max_pages override (${getroPages} pages)`);
  else fail(`getro.fetch() made ${getroPages} requests despite the clamp`);

  // Malformed / empty payload → empty array, no crash, no infinite pagination.
  const getroEmpty = await getro.fetch({ name: 'b2v', getro_collection: 4283 }, { fetchJson: async () => ({}) });
  if (Array.isArray(getroEmpty) && getroEmpty.length === 0) pass('getro.fetch() tolerates an empty payload');
  else fail(`getro.fetch() empty handling: ${JSON.stringify(getroEmpty)}`);
} catch (e) {
  fail(`getro provider tests crashed: ${e.message}`);
}
