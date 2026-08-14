// tests/providers/consider.test.mjs — direct provider-contract tests (PR #825).
// Consider boards take their origin from a config-driven careers_url, so the
// host guard is the security boundary here: detect() and fetch() must both
// reject non-https, IP-literal, loopback, link-local, and internal-suffix hosts
// before any request goes out. Also covers the redirect:'error' guard and
// malformed-payload tolerance.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — consider');

try {
  const consider = (await import(pathToFileURL(join(ROOT, 'providers/consider.mjs')).href)).default;

  if (consider.id === 'consider') pass('consider.id is "consider"');
  else fail(`consider.id is ${JSON.stringify(consider.id)}`);

  const okEntry = { name: 'Founderful', consider_board: 'wingman', careers_url: 'https://jobs.founderful.com/jobs' };
  const hit = consider.detect(okEntry);
  if (hit && hit.url === 'https://jobs.founderful.com/api-boards/search-jobs') pass('consider.detect() claims a valid https board');
  else fail(`consider.detect() returned ${JSON.stringify(hit)}`);

  if (consider.detect({ name: 'X', careers_url: 'https://jobs.founderful.com/jobs' }) === null) {
    pass('consider.detect() returns null without consider_board');
  } else {
    fail('consider.detect() must require consider_board');
  }

  // SSRF: non-https + IP-literal + loopback/internal hosts are all rejected.
  const considerEvil = [
    ['http://jobs.founderful.com/jobs', 'non-https'],
    ['https://127.0.0.1/jobs', 'IPv4 loopback'],
    ['https://169.254.169.254/jobs', 'cloud metadata IPv4'],
    ['https://[::1]/jobs', 'IPv6 loopback'],
    ['https://localhost/jobs', 'localhost'],
    ['https://stuff.internal/jobs', '.internal suffix'],
    ['https://box.local/jobs', '.local suffix'],
  ];
  let considerBlocked = 0;
  for (const [url, label] of considerEvil) {
    if (consider.detect({ name: 'Evil', consider_board: 'x', careers_url: url }) === null) considerBlocked++;
    else fail(`consider.detect() should reject unsafe host (${label}): ${url}`);
  }
  if (considerBlocked === considerEvil.length) pass(`consider host guard rejects ${considerEvil.length} unsafe hosts (SSRF)`);

  // fetch() passes redirect:'error' on the happy path.
  let considerOpts = null;
  const considerJobs = await consider.fetch(okEntry, {
    fetchJson: async (_url, opts) => {
      considerOpts = opts;
      return { jobs: [{ title: 'AI Eng', url: 'https://jobs.founderful.com/x', companyName: 'Acme', locations: ['Remote'], timeStamp: '2026-01-02' }] };
    },
  });
  if (considerOpts?.redirect === 'error') pass('consider.fetch() passes redirect:"error"');
  else fail(`consider.fetch() should pass redirect:"error", got ${JSON.stringify(considerOpts)}`);
  if (considerJobs.length === 1 && considerJobs[0].company === 'Acme') pass('consider.fetch() normalizes a job row');
  else fail(`consider.fetch() row = ${JSON.stringify(considerJobs[0])}`);

  // postedAt is derived from timeStamp — both the ISO and epoch-ms shapes.
  if (considerJobs[0].postedAt === Date.parse('2026-01-02')) pass('consider.fetch() maps an ISO timeStamp to postedAt');
  else fail(`consider.fetch() postedAt = ${JSON.stringify(considerJobs[0].postedAt)}`);

  // A non-positive stamp is treated as missing, not as 1970 (which would read
  // as permanently stale to the freshness filter).
  const considerZeroStamp = await consider.fetch(okEntry, {
    fetchJson: async () => ({ jobs: [{ title: 'T', url: 'https://jobs.founderful.com/y', companyName: 'Acme', timeStamp: 0 }] }),
  });
  if (considerZeroStamp[0]?.postedAt == null) pass('consider.fetch() treats a 0 timeStamp as missing, not epoch 0');
  else fail(`consider.fetch() postedAt for timeStamp=0 = ${JSON.stringify(considerZeroStamp[0]?.postedAt)}`);

  // fetch() refuses an unsafe host BEFORE touching the network.
  let considerThrew = false;
  try {
    await consider.fetch(
      { name: 'Evil', consider_board: 'x', careers_url: 'https://169.254.169.254/jobs' },
      { fetchJson: async () => { throw new Error('SSRF! should not reach here'); } },
    );
  } catch (e) { considerThrew = /public host|https/.test(e.message); }
  if (considerThrew) pass('consider.fetch() rejects unsafe host before fetch');
  else fail('consider.fetch() must throw on an unsafe host without fetching');

  // Malformed / empty payloads → empty array, no crash.
  const considerEmpty = await consider.fetch(okEntry, { fetchJson: async () => ({}) });
  const considerNoUrl = await consider.fetch(okEntry, { fetchJson: async () => ({ jobs: [{ title: 'No URL' }] }) });
  if (Array.isArray(considerEmpty) && considerEmpty.length === 0 && Array.isArray(considerNoUrl) && considerNoUrl.length === 0) {
    pass('consider.fetch() tolerates malformed/empty payloads');
  } else {
    fail(`consider.fetch() malformed handling: ${JSON.stringify({ considerEmpty, considerNoUrl })}`);
  }
} catch (e) {
  fail(`consider provider tests crashed: ${e.message}`);
}
