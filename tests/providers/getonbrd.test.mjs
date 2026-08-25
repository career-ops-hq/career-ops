// tests/providers/getonbrd.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — getonbrd');


try {
  const getonbrdModule = await import(pathToFileURL(join(ROOT, 'providers/getonbrd.mjs')).href);
  const getonbrd = getonbrdModule.default;

  if (getonbrd.id === 'getonbrd') pass('getonbrd.id is "getonbrd"');
  else fail(`getonbrd.id is ${JSON.stringify(getonbrd.id)}`);

  // Deterministic JSON:API sample — no network. Two valid jobs plus two dropped
  // (empty title, non-absolute url).
  const sample = {
    data: [
      {
        attributes: {
          title: 'Staff AI Engineer',
          remote: true,
          countries: 'Remote',
          company: { data: { attributes: { name: 'Acme Corp' } } },
        },
        links: { public_url: 'https://www.getonbrd.com/jobs/acme-staff-ai-engineer' },
      },
      {
        attributes: {
          title: '  Platform Engineer  ',                  // leading/trailing space → trimmed
          remote: false,
          countries: ['Chile'],                            // live API sends an array of country names
          published_at: 1700000000,                        // epoch seconds → postedAt in ms
          company: { data: { attributes: { name: '' } } }, // empty → falls back to entry.name
        },
        links: { public_url: '  https://www.getonbrd.com/jobs/beta-platform-engineer  ' },
      },
      {
        attributes: { title: '', company: { data: { attributes: { name: 'Bad Co' } } } }, // dropped: empty title
        links: { public_url: 'https://www.getonbrd.com/jobs/bad-empty-title' },
      },
      {
        attributes: { title: 'Relative URL Role', remote: true },                          // dropped: non-absolute url
        links: { public_url: '/jobs/relative' },
      },
    ],
  };

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await getonbrd.fetch(
    { name: 'GetOnBoard Feed', provider: 'getonbrd' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://www.getonbrd.com/api/v0/categories/programming/jobs?per_page=100&expand[]=company&page=1')
    pass('getonbrd.fetch() requests the board-wide category feed URL (page 1)');
  else fail(`getonbrd.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('getonbrd.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  else fail(`getonbrd.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('getonbrd.fetch() keeps 2 valid jobs (drops empty-title + non-absolute-url rows)');
  else fail(`getonbrd.fetch() returned ${fetched.length} jobs (expected 2)`);

  if (fetched[0] && Object.keys(fetched[0]).sort().join(',') === 'company,location,title,url')
    pass('getonbrd.fetch() returns the normalized { title, url, company, location } shape');
  else fail(`getonbrd.fetch() row 0 keys = ${JSON.stringify(fetched[0] && Object.keys(fetched[0]))}`);

  if (fetched[0]?.title === 'Staff AI Engineer'
      && fetched[0]?.url === 'https://www.getonbrd.com/jobs/acme-staff-ai-engineer'
      && fetched[0]?.company === 'Acme Corp'
      && fetched[0]?.location === 'Remote')
    pass('getonbrd.fetch() maps title/url/company and uses "Remote" when remote===true');
  else fail(`getonbrd.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.title === 'Platform Engineer'
      && fetched[1]?.url === 'https://www.getonbrd.com/jobs/beta-platform-engineer')
    pass('getonbrd.fetch() trims whitespace from title and url');
  else fail(`getonbrd.fetch() row 1 title/url = ${JSON.stringify({ title: fetched[1]?.title, url: fetched[1]?.url })}`);

  if (fetched[1]?.company === 'GetOnBoard Feed')
    pass('getonbrd.fetch() falls back to entry.name when the company name is empty');
  else fail(`getonbrd.fetch() row 1 company = ${JSON.stringify(fetched[1]?.company)}`);

  if (fetched[1]?.location === 'Chile')
    pass('getonbrd.fetch() joins the countries array into location when not remote');
  else fail(`getonbrd.fetch() row 1 location = ${JSON.stringify(fetched[1]?.location)}`);

  if (fetched[1]?.postedAt === 1700000000 * 1000)
    pass('getonbrd.fetch() maps published_at (epoch seconds) to postedAt in ms');
  else fail(`getonbrd.fetch() row 1 postedAt = ${JSON.stringify(fetched[1]?.postedAt)}`);

  const noName = await getonbrd.fetch(
    {},
    { fetchJson: async () => ({ data: [{ attributes: { title: 'Role', remote: true }, links: { public_url: 'https://www.getonbrd.com/jobs/x' } }] }) },
  );
  if (noName[0]?.company === 'Get on Board')
    pass('getonbrd.fetch() defaults company to "Get on Board" when name and entry.name are both missing');
  else fail(`getonbrd.fetch() default company = ${JSON.stringify(noName[0]?.company)}`);

  let badResponseThrew = false;
  try {
    await getonbrd.fetch(
      { name: 'X', provider: 'getonbrd' },
      { fetchJson: async () => ({ wrong: true }) },
    );
  } catch (e) {
    badResponseThrew = /unexpected API response/.test(e.message);
  }
  if (badResponseThrew) pass('getonbrd.fetch() throws on unexpected API response shape');
  else fail('getonbrd.fetch() should throw when the data array is absent');

  // Pagination: a full first page (=per_page) is followed until a short page.
  const mkJob = i => ({ attributes: { title: `Role ${i}`, remote: true }, links: { public_url: `https://www.getonbrd.com/jobs/role-${i}` } });
  const fullPage = { data: Array.from({ length: 100 }, (_, i) => mkJob(i)) };
  const shortPage = { data: [mkJob(999)] };

  const pageCalls = [];
  const paged = await getonbrd.fetch(
    { name: 'GOB', provider: 'getonbrd' },
    { fetchJson: async (url, opts) => { pageCalls.push({ url, opts }); return pageCalls.length === 1 ? fullPage : shortPage; } },
  );
  const pageUrls = pageCalls.map((c) => c.url);
  if (pageCalls.length === 2 && /[?&]page=1(?:&|$)/.test(pageUrls[0]) && /[?&]page=2(?:&|$)/.test(pageUrls[1]))
    pass('getonbrd.fetch() paginates ?page=N until a short page is returned');
  else fail(`getonbrd.fetch() page URLs = ${JSON.stringify(pageUrls)}`);

  if (pageCalls.length > 1 && pageCalls.every((c) => c.opts && c.opts.redirect === 'error'))
    pass('getonbrd.fetch() passes redirect:"error" on every paginated request (not just page 1)');
  else fail(`getonbrd.fetch() paginated opts = ${JSON.stringify(pageCalls.map((c) => c.opts))}`);

  if (paged.length === 101)
    pass('getonbrd.fetch() accumulates jobs across pages (100 + 1)');
  else fail(`getonbrd.fetch() paginated total = ${paged.length} (expected 101)`);

  const capCalls = [];
  await getonbrd.fetch(
    { name: 'GOB', max_pages: 1 },
    { fetchJson: async (url) => { capCalls.push(url); return fullPage; } },
  );
  if (capCalls.length === 1)
    pass('getonbrd.fetch() respects the max_pages override (stops after 1 page)');
  else fail(`getonbrd.fetch() max_pages=1 made ${capCalls.length} page calls`);

} catch (e) {
  fail(`getonbrd provider tests crashed: ${e.message}`);
}

