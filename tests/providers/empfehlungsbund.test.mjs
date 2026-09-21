// tests/providers/empfehlungsbund.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — Empfehlungsbund (public SSR search)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/empfehlungsbund.mjs')).href);
  const provider = mod.default;
  const { resolveSearchUrl, parseJobCards } = mod;

  if (provider.id === 'empfehlungsbund') pass('empfehlungsbund.id is "empfehlungsbund"');
  else fail(`empfehlungsbund.id is ${JSON.stringify(provider.id)}`);

  if (resolveSearchUrl({ api: 'https://www.empfehlungsbund.de/jobs/search?q=java' }) === 'https://en.empfehlungsbund.de/jobs/search?q=java') {
    pass('resolveSearchUrl() routes the trusted German URL to the Node-accessible public search and preserves its query');
  } else {
    fail('resolveSearchUrl() should route to the Node-accessible public search and preserve its query');
  }
  if (resolveSearchUrl({ careers_url: 'https://www.empfehlungsbund.de/' }) === 'https://en.empfehlungsbund.de/jobs/search') {
    pass('resolveSearchUrl() maps the trusted portal root to the canonical search URL');
  } else {
    fail('resolveSearchUrl() should map the portal root to /jobs/search');
  }
  if (resolveSearchUrl({ api: 'https://www.empfehlungsbund.de.evil.test/jobs/search' }) === null) {
    pass('resolveSearchUrl() rejects a suffix-spoofed host');
  } else {
    fail('resolveSearchUrl() should reject a suffix-spoofed host');
  }

  const card = (id, company, title, location) =>
    `<div class="job-element bg-white"><a title="${company}" href="/partner_profil/${id}">logo</a>` +
    `<h3 class="text-start"><a class="stretched-link" href="/jobs/${id}/${title.toLowerCase().replace(/\\s+/g, '-')}">${title}</a></h3>` +
    `<div class="text-muted small">${location}</div></div>`;
  const pageHtml = '<html>'
    + card('303008', 'MGM &amp; Co.', 'Junior Softwareentwickler (m/w/d)', 'Aachen, Berlin')
    + card('303009', 'Example GmbH', 'IT Support', 'Leipzig')
    + '</html>';
  const rows = parseJobCards(pageHtml, 'https://en.empfehlungsbund.de');
  if (rows.length === 2) pass('parseJobCards() extracts one row per job card');
  else fail(`parseJobCards() returned ${rows.length} rows, expected 2`);
  if (rows[0]?.id === '303008' && rows[0]?.title === 'Junior Softwareentwickler (m/w/d)'
      && rows[0]?.company === 'MGM & Co.' && rows[0]?.location === 'Aachen, Berlin'
      && rows[0]?.url === 'https://en.empfehlungsbund.de/jobs/303008/junior%20softwareentwickler%20(m/w/d)') {
    pass('parseJobCards() maps canonical URL, title, employer, and multi-city location');
  } else {
    fail(`parseJobCards() first row = ${JSON.stringify(rows[0])}`);
  }
  if (parseJobCards(card('3', 'Co', 'Bad', 'Berlin').replace('/jobs/3/', 'https://evil.test/jobs/3/'), 'https://en.empfehlungsbund.de').length === 0) {
    pass('parseJobCards() drops off-host job links');
  } else {
    fail('parseJobCards() should drop off-host job links');
  }
  if (parseJobCards('<html>no job cards</html>', 'https://en.empfehlungsbund.de').length === 0) {
    pass('parseJobCards() returns [] for card-less HTML');
  } else {
    fail('parseJobCards() should return [] for card-less HTML');
  }

  const pages = [pageHtml, card('303009', 'Example GmbH', 'IT Support', 'Leipzig')];
  const requested = [];
  let calls = 0;
  const jobs = await provider.fetch(
    { name: 'Empfehlungsbund', api: 'https://en.empfehlungsbund.de/jobs/search?fid=0', max_pages: 5 },
    { fetchText: async (url, options) => { requested.push({ url, redirect: options?.redirect }); return pages[calls++] ?? pages[1]; } },
  );
  if (jobs.length === 2 && calls === 2) pass('fetch() stops when the next page has no fresh job IDs');
  else fail(`fetch() returned ${jobs.length} jobs after ${calls} calls`);
  if (requested[0]?.url === 'https://en.empfehlungsbund.de/jobs/search?fid=0&page=1'
      && requested[1]?.url === 'https://en.empfehlungsbund.de/jobs/search?fid=0&page=2') {
    pass('fetch() retains configured query parameters while paging');
  } else {
    fail(`fetch() requested ${JSON.stringify(requested.map(({ url }) => url))}`);
  }
  if (requested.every(({ redirect }) => redirect === 'error')) pass('fetch() passes redirect:"error" for every request');
  else fail(`fetch() redirect options = ${JSON.stringify(requested)}`);
} catch (err) {
  fail(`empfehlungsbund provider tests crashed: ${err.message}`);
}
