// tests/vc-portfolios-yc-pagination.test.mjs — fetchYCCompanies must walk every
// page the YC API reports, follow the nextPage target when totalPages is absent,
// and never spin past the YC_MAX_PAGES hard ceiling.
//
// The API caps its page size (~30 today) and ignores per_page=1000, so a naive
// "stop when a page returns fewer than N companies" walk only ever saw the
// newest batch. These tests serve small paginated batches through a stubbed
// global.fetch and assert the walk follows the API's own totalPages / nextPage
// signal, clamped to the ceiling.

import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nvc-portfolios — YC pagination (issue #2525)');

const mod = await import(pathToFileURL(join(ROOT, 'seeds/vc-portfolios.mjs')).href);
const { fetchYCCompanies, parseYCNextPage, YC_MAX_PAGES } = mod;

const realFetch = global.fetch;

// Install a fake global.fetch that serves `pages` (an array of company arrays),
// one array per page, with the pagination metadata the real API returns.
// Records which page numbers were requested.
function installYCFetch(pages, { totalPages = true, nextPage = false } = {}) {
  const requested = [];
  global.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    requested.push(page);
    const companies = pages[page - 1] || [];
    const body = { companies, page };
    if (totalPages) body.totalPages = pages.length;
    if (nextPage) body.nextPage = page < pages.length ? `page=${page + 1}` : null;
    return { ok: true, async json() { return body; }, async text() { return ''; } };
  };
  return requested;
}

const co = (name) => ({ name, slug: name.toLowerCase() });
const THREE_PAGES = [
  [co('Alpha'), co('Beta')],
  [co('Gamma'), co('Delta')],
  [co('Epsilon')],
];

try {
  // Core: small batches (< per_page) across 3 pages must all be walked.
  {
    const requested = installYCFetch(THREE_PAGES, { totalPages: true });
    const out = await fetchYCCompanies();
    const slugs = out.map((c) => c.slug).sort();
    if (slugs.length === 5 && requested.join(',') === '1,2,3') {
      pass('walks all pages reported by totalPages (5 companies over pages 1,2,3)');
    } else {
      fail(`expected 5 companies over pages 1,2,3, got ${slugs.length} over pages ${requested.join(',')}`);
    }
  }

  // When totalPages is absent, follow the nextPage *target*, not page+1 — a
  // non-sequential nextPage must be honoured. Page 1 points at page 3, so page 2
  // must never be requested. Fails if nextPage is treated as a boolean.
  {
    const pageData = { 1: [co('Alpha')], 3: [co('Gamma')] };
    const nextFor = { 1: 'page=3', 3: null };
    const requested = [];
    global.fetch = async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      requested.push(page);
      return {
        ok: true,
        async json() { return { companies: pageData[page] || [], page, nextPage: nextFor[page] }; },
        async text() { return ''; },
      };
    };
    const out = await fetchYCCompanies();
    const slugs = out.map((c) => c.slug).sort();
    if (slugs.join(',') === 'alpha,gamma' && requested.join(',') === '1,3') {
      pass('follows a non-sequential nextPage target (requests 1,3 — never 2)');
    } else {
      fail(`nextPage-target walk got ${slugs.join(',')} over pages ${requested.join(',')}`);
    }
  }

  // Dedupes by slug across pages.
  {
    const dupPages = [[co('Alpha'), co('Beta')], [co('Alpha'), co('Gamma')]];
    installYCFetch(dupPages, { totalPages: true });
    const out = await fetchYCCompanies();
    const slugs = out.map((c) => c.slug).sort();
    if (slugs.join(',') === 'alpha,beta,gamma') {
      pass('dedupes companies by slug across pages');
    } else {
      fail(`expected alpha,beta,gamma got ${slugs.join(',')}`);
    }
  }

  // parseYCNextPage reads a forward page number from the shapes the API might
  // use, and rejects anything without one.
  {
    const cases = [
      [3, 3],
      ['page=3', 3],
      ['?page=3&x=1', 3],
      ['https://api.ycombinator.com/v0.1/companies?page=7&per_page=1000', 7],
      ['/companies/page/4', 4],
      ['  5  ', 5],
      [null, null],
      [false, null],
      ['', null],
      ['next', null],
      [0, null],
      [-2, null],
    ];
    let ok = true;
    let detail = '';
    for (const [input, expected] of cases) {
      const got = parseYCNextPage(input);
      if (got !== expected) { ok = false; detail = `parseYCNextPage(${JSON.stringify(input)}) = ${got}, expected ${expected}`; break; }
    }
    if (ok) pass('parseYCNextPage reads page numbers from number, fragment, and URL forms');
    else fail(detail);
  }

  // YC_MAX_PAGES is a hard ceiling. The expected value is pinned independently of
  // the exported constant, so raising the cap can't quietly satisfy this test —
  // the contract is 500.
  {
    const EXPECTED_YC_MAX_PAGES = 500;
    if (YC_MAX_PAGES === EXPECTED_YC_MAX_PAGES) {
      pass(`YC_MAX_PAGES is the contracted ${EXPECTED_YC_MAX_PAGES}-page ceiling`);
    } else {
      fail(`YC_MAX_PAGES is ${YC_MAX_PAGES}, expected ${EXPECTED_YC_MAX_PAGES}`);
    }

    const requested = [];
    global.fetch = async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      requested.push(page);
      // Always one more company and always a next page → unbounded without the cap.
      return {
        ok: true,
        async json() { return { companies: [co('C' + page)], page, nextPage: `page=${page + 1}` }; },
        async text() { return ''; },
      };
    };
    const out = await fetchYCCompanies({ maxPages: Infinity });
    if (requested.length === EXPECTED_YC_MAX_PAGES && out.length === EXPECTED_YC_MAX_PAGES) {
      pass(`clamps the walk to ${EXPECTED_YC_MAX_PAGES} pages even when maxPages is Infinity`);
    } else {
      fail(`expected ${EXPECTED_YC_MAX_PAGES} requests, got ${requested.length} (companies ${out.length})`);
    }
  }
} finally {
  global.fetch = realFetch;
}
