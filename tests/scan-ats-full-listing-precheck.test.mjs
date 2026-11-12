// tests/scan-ats-full-listing-precheck.test.mjs — the reverse sweep rules a
// Greenhouse board out from its cheap listing (no posting bodies) before
// paying for the full fetch, and the pre-check never drops a board that
// processJobs() could have kept.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — cheap listing pre-check');

const { listingMayMatch, undatedInListing } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const greenhouse = (await import(pathToFileURL(join(ROOT, 'providers/greenhouse.mjs')).href)).default;

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const cutoff = Date.parse('2026-10-01T00:00:00Z');
const titleFilter = (title) => /solidity/i.test(title);
const opts = { cutoff, titleFilter, companySlug: 'acme' };
const job = (title, postedAt) => ({ title, url: `https://job-boards.greenhouse.io/acme/jobs/${title.length}`, postedAt });

check(listingMayMatch([job('Solidity Engineer', Date.parse('2026-10-05'))], opts), 'a fresh title match keeps the board');
check(!listingMayMatch([job('Account Executive', Date.parse('2026-10-05'))], opts), 'no title match rules the board out');
check(!listingMayMatch([job('Solidity Engineer', Date.parse('2026-09-01'))], opts), 'a stale title match rules the board out');
check(listingMayMatch([job('Solidity Engineer', null)], opts), 'an undated title match keeps the board: processJobs() decides it');
check(!listingMayMatch([], opts), 'an empty board is ruled out');
check(!listingMayMatch([{ title: 'Solidity Engineer', postedAt: Date.parse('2026-10-05') }], opts), 'a posting without a URL never counts');
{
  let slugSeen = null;
  listingMayMatch([job('Solidity Engineer', null)], { cutoff, titleFilter: (t, slug) => { slugSeen = slug; return true; }, companySlug: 'acme' });
  check(slugSeen === 'acme', 'the company slug reaches the title filter (title_filter_overrides are per company)');
}
check(undatedInListing([job('Account Executive', null), job('Solidity Engineer', Date.parse('2026-10-05')), job('Old', Date.parse('2026-09-01'))], cutoff) === 1,
  'a ruled-out board still reports its undated postings, as processJobs() would');
check(undatedInListing([{ title: 'No URL', postedAt: null }], cutoff) === 0, 'a posting without a URL is not counted as undated');

// greenhouse.fetchListing(): the list endpoint without content=true, mapped to title/url/postedAt
{
  let requested = null;
  let requestedOpts = null;
  const listing = await greenhouse.fetchListing(
    { name: 'Acme', api: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true' },
    {
      fetchJson: async (url, opts) => {
        requested = url;
        requestedOpts = opts;
        return { jobs: [
          { id: 1, title: 'Solidity Engineer', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', first_published: '2026-10-05T10:00:00Z' },
          { id: 2, title: 'No URL' },
        ] };
      },
    },
  );
  check(requested === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs', `fetchListing drops a pinned content=true (requested ${requested})`);
  check(requestedOpts?.redirect === 'error', 'fetchListing refuses redirects, as fetch() does');
  check(listing.length === 1 && listing[0].url === 'https://job-boards.greenhouse.io/acme/jobs/1', 'fetchListing keeps only postings with a URL');
  check(listing[0].postedAt === Date.parse('2026-10-05T10:00:00Z'), 'fetchListing dates postings from first_published, as fetch() does');
}
{
  let threw = false;
  try {
    await greenhouse.fetchListing({ name: 'Evil', api: 'https://evil.example/v1/boards/x/jobs' }, { fetchJson: async () => ({ jobs: [] }) });
  } catch { threw = true; }
  check(threw, 'fetchListing runs the Greenhouse host allowlist before any request');
}
