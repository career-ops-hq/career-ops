// tests/providers/board-browser.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — board-browser');

try {
  const scrapeMod = await import(pathToFileURL(join(ROOT, 'providers/_browser-scrape.mjs')).href);
  const boardMod = await import(pathToFileURL(join(ROOT, 'providers/board-browser.mjs')).href);
  const boardBrowser = boardMod.default;
  const { extractBoardJobs, defaultCompanyFromEntry } = scrapeMod;

  if (boardBrowser.id === 'board-browser') pass('board-browser.id is "board-browser"');
  else fail(`board-browser.id is ${JSON.stringify(boardBrowser.id)}`);

  const hit = boardBrowser.detect({
    name: 'Instahyre — AI PM',
    provider: 'board-browser',
    search_url: 'https://www.instahyre.com/search-jobs/?skills=AI',
    link_match: 'instahyre\\.com/job-',
  });
  if (hit?.url?.includes('instahyre.com')) {
    pass('board-browser.detect() claims explicit provider config');
  } else {
    fail(`board-browser.detect() returned ${JSON.stringify(hit)}`);
  }

  if (boardBrowser.detect({ name: 'Other', provider: 'greenhouse' }) === null) {
    pass('board-browser.detect() ignores other provider ids');
  } else {
    fail('board-browser.detect() should only claim provider: board-browser');
  }

  const anchors = [
    { href: '/company/acme', label: 'Senior AI Engineer at Acme' },
    { href: 'https://wellfound.com/jobs/999-slug', label: 'Product Manager at Beta Co' },
    { href: 'https://wellfound.com/company/login', label: 'Sign in' },
    { href: '/about', label: 'About us' },
    { href: 'https://wellfound.com/jobs/999-slug', label: 'Duplicate' },
  ];
  const jobs = extractBoardJobs(anchors, 'https://wellfound.com/jobs', {
    linkMatch: 'wellfound\\.com/jobs/\\d+',
    excludeMatch: 'login',
    defaultCompany: 'Wellfound',
    maxJobs: 10,
  });

  if (jobs.length === 1 && jobs[0].title === 'Product Manager' && jobs[0].company === 'Beta Co') {
    pass('extractBoardJobs filters by link_match, exclude_match, dedups, parses labels');
  } else {
    fail(`extractBoardJobs => ${JSON.stringify(jobs)}`);
  }

  const insta = extractBoardJobs(
    [{ href: 'https://www.instahyre.com/job-42-ai-product-manager-bangalore', label: '' }],
    'https://www.instahyre.com/search-jobs/',
    { linkMatch: 'instahyre\\.com/job-', defaultCompany: 'Instahyre' },
  );
  if (insta.length === 1 && insta[0].title.includes('product manager')) {
    pass('extractBoardJobs falls back to URL slug when label is empty');
  } else {
    fail(`extractBoardJobs slug fallback => ${JSON.stringify(insta)}`);
  }

  if (defaultCompanyFromEntry({ name: 'Wellfound — AI PM India' }) === 'Wellfound') {
    pass('defaultCompanyFromEntry strips board suffix after em dash');
  } else {
    fail('defaultCompanyFromEntry should strip suffix');
  }

  let threw = false;
  try {
    await boardBrowser.fetch({ name: 'Bad', provider: 'board-browser', link_match: 'x' });
  } catch (err) {
    threw = /search_url|careers_url/.test(err.message);
  }
  if (threw) pass('board-browser.fetch() rejects missing listing URL');
  else fail('board-browser.fetch() should require search_url or careers_url');

  threw = false;
  try {
    await boardBrowser.fetch({
      name: 'Bad',
      provider: 'board-browser',
      search_url: 'https://wellfound.com/jobs',
    });
  } catch (err) {
    threw = /link_match/.test(err.message);
  }
  if (threw) pass('board-browser.fetch() rejects missing link_match');
  else fail('board-browser.fetch() should require link_match');
} catch (e) {
  fail(`board-browser provider tests crashed: ${e.message}`);
}
