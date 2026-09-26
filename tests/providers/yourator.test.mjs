// tests/providers/yourator.test.mjs — mirrors the remotli/arbeitnow board-wide provider tests.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — yourator');

try {
  const youratorModule = await import(pathToFileURL(join(ROOT, 'providers/yourator.mjs')).href);
  const yourator = youratorModule.default;
  const { normalizeYouratorJob, resolveYouratorUrl } = youratorModule;

  if (yourator.id === 'yourator') pass('yourator.id is "yourator"');
  else fail(`yourator.id is ${JSON.stringify(yourator.id)}`);

  // --- resolveYouratorUrl — Source Indexing Policy rule 2 -------------------

  // thirdPartyUrl (the employer's ATS) wins over the board page.
  const employer = resolveYouratorUrl({
    path: '/companies/HourLoop/jobs/1',
    thirdPartyUrl: 'https://hourloophr.teamdoor.io/job/abc',
  });
  if (employer === 'https://hourloophr.teamdoor.io/job/abc') {
    pass('resolveYouratorUrl prefers thirdPartyUrl over the board page (rule 2)');
  } else {
    fail(`resolveYouratorUrl employer url = ${JSON.stringify(employer)}`);
  }

  // utm_* ad params are stripped; functional params survive.
  const stripped = resolveYouratorUrl({
    path: '/companies/AmazingTalker/jobs/2',
    thirdPartyUrl: 'https://amazingtalker.breezy.hr/p/b76848?utm_source=yourator&utm_medium=ads&UTM_Campaign=general&ref=keep',
  });
  if (stripped === 'https://amazingtalker.breezy.hr/p/b76848?ref=keep') {
    pass('resolveYouratorUrl strips utm_* (case-insensitively) and keeps functional params');
  } else {
    fail(`resolveYouratorUrl stripped url = ${JSON.stringify(stripped)}`);
  }

  // non-https / malformed thirdPartyUrl → fall back to the board page.
  const fallbacks = [
    resolveYouratorUrl({ path: '/companies/x/jobs/3', thirdPartyUrl: 'http://insecure.example/j' }),
    resolveYouratorUrl({ path: '/companies/x/jobs/3', thirdPartyUrl: 'not a url' }),
    resolveYouratorUrl({ path: '/companies/x/jobs/3' }),
  ];
  if (fallbacks.every(u => u === 'https://www.yourator.co/companies/x/jobs/3')) {
    pass('resolveYouratorUrl falls back to the board page on non-https / malformed / absent thirdPartyUrl');
  } else {
    fail(`resolveYouratorUrl fallbacks = ${JSON.stringify(fallbacks)}`);
  }

  // path shapes that escape SITE_ORIGIN must not become the fallback.
  const escapes = [
    resolveYouratorUrl({ path: '//evil.example/jobs/1' }),
    resolveYouratorUrl({ path: '/\\evil.example/jobs/2' }),
    resolveYouratorUrl({ path: 'https://evil.example/jobs/3' }),
    resolveYouratorUrl({ path: 'companies/x/jobs/4' }),
    resolveYouratorUrl({}),
  ];
  if (escapes.every(u => u === '')) {
    pass('resolveYouratorUrl rejects protocol-relative / backslash / absolute / non-rooted paths');
  } else {
    fail(`resolveYouratorUrl escapes = ${JSON.stringify(escapes)}`);
  }

  // --- normalizeYouratorJob ------------------------------------------------

  const full = normalizeYouratorJob(
    {
      id: 22295,
      name: '  【AmazingTalker】法務專員｜Legal Specialist  ',
      path: '/companies/AmazingTalker/jobs/22295',
      salary: 'NT$ 50,000 - 80,000 (月薪)',
      lastActiveAt: '一天內更新',
      location: '  新北市  ',
      company: { brand: '  AmazingTalker  ' },
    },
    'Fallback',
  );
  if (
    full &&
    full.title === '【AmazingTalker】法務專員｜Legal Specialist' &&
    full.url === 'https://www.yourator.co/companies/AmazingTalker/jobs/22295' &&
    full.company === 'AmazingTalker' &&
    full.location === '新北市'
  ) {
    pass('normalizeYouratorJob maps + trims name/path/company.brand/location');
  } else {
    fail(`normalizeYouratorJob full row = ${JSON.stringify(full)}`);
  }

  if (full && !('postedAt' in full)) pass('normalizeYouratorJob never emits postedAt (no absolute date in the payload)');
  else fail(`normalizeYouratorJob postedAt presence = ${JSON.stringify(full)}`);

  const coFromEntry = normalizeYouratorJob({ name: 'T', path: '/companies/x/jobs/1', company: { brand: '  ' } }, 'Entry Name');
  const coDefault = normalizeYouratorJob({ name: 'T', path: '/companies/x/jobs/2' });
  if (coFromEntry?.company === 'Entry Name' && coDefault?.company === 'Yourator') {
    pass('normalizeYouratorJob falls back company → entry name → "Yourator"');
  } else {
    fail(`normalizeYouratorJob company fallbacks = ${JSON.stringify({ a: coFromEntry?.company, b: coDefault?.company })}`);
  }

  const noLoc = normalizeYouratorJob({ name: 'T', path: '/companies/x/jobs/3' });
  if (noLoc?.location === '') pass('normalizeYouratorJob yields an empty location when absent');
  else fail(`normalizeYouratorJob missing location = ${JSON.stringify(noLoc?.location)}`);

  const drops = [
    normalizeYouratorJob({ name: '', path: '/companies/x/jobs/d1' }),
    normalizeYouratorJob({ name: 'No usable url', path: '//evil.example/d2' }),
    normalizeYouratorJob({ name: 'No path at all' }),
    normalizeYouratorJob(null),
    normalizeYouratorJob('nope'),
  ];
  if (drops.every(r => r === null)) {
    pass('normalizeYouratorJob drops empty-name / unusable-url / non-object rows');
  } else {
    fail(`normalizeYouratorJob drops = ${JSON.stringify(drops)}`);
  }

  // --- fetch() -------------------------------------------------------------

  const mk = (i) => ({ name: `Role ${i}`, path: `/companies/co/jobs/${i}`, location: '臺北市', company: { brand: `Co ${i}` } });
  const pages = {
    1: { payload: { hasMore: true, jobs: Array.from({ length: 20 }, (_, i) => mk(i)) } },
    2: { payload: { hasMore: false, jobs: [...Array.from({ length: 19 }, (_, i) => mk(20 + i)), { name: '', path: '/companies/co/jobs/bad' }] } },
    3: { payload: { hasMore: true, jobs: [mk(99)] } }, // must never be requested
  };
  const requested = [];
  const ctx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      requested.push({ url, redirect: opts?.redirect });
      return pages[Number(new URL(url).searchParams.get('page'))];
    },
  };
  const jobs = await yourator.fetch({ name: 'Yourator' }, ctx);
  const urls = requested.map(r => r.url);
  if (
    jobs.length === 39 &&
    urls.length === 2 &&
    urls[0] === 'https://www.yourator.co/api/v4/jobs?page=1' &&
    urls[1] === 'https://www.yourator.co/api/v4/jobs?page=2' &&
    requested.every(r => r.redirect === 'error')
  ) {
    pass('yourator.fetch paginates ?page=N, stops on hasMore:false, drops bad rows, sends redirect:"error"');
  } else {
    fail(`yourator.fetch pagination = ${JSON.stringify({ count: jobs.length, urls, redirects: requested.map(r => r.redirect) })}`);
  }

  // Regression: a SHORT intermediate page with hasMore:true must NOT stop the
  // walk. hasMore is the API's own end-of-board signal; a page-length heuristic
  // would silently truncate the board (CodeRabbit, PR #3030).
  const shortPages = {
    1: { payload: { hasMore: true, jobs: [mk(0), mk(1), mk(2)] } },   // 3 < 20, but hasMore:true
    2: { payload: { hasMore: true, jobs: Array.from({ length: 20 }, (_, i) => mk(10 + i)) } },
    3: { payload: { hasMore: false, jobs: [mk(90)] } },
  };
  const shortRequested = [];
  const shortJobs = await yourator.fetch(
    { name: 'Yourator' },
    {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async (url) => {
        shortRequested.push(url);
        return shortPages[Number(new URL(url).searchParams.get('page'))];
      },
    },
  );
  if (shortRequested.length === 3 && shortJobs.length === 24) {
    pass('yourator.fetch keeps walking past a short page while hasMore is true');
  } else {
    fail(`yourator.fetch short-page walk = ${JSON.stringify({ pages: shortRequested.length, jobs: shortJobs.length })}`);
  }

  // ctx.maxPages (health probe) wins over max_pages on the entry.
  const probed = [];
  await yourator.fetch(
    { name: 'Yourator', max_pages: 50 },
    {
      transport: 'http',
      maxPages: 1,
      sleep: async () => {},
      fetchJson: async (url) => {
        probed.push(url);
        return pages[Number(new URL(url).searchParams.get('page'))];
      },
    },
  );
  if (probed.length === 1) pass('yourator.fetch honors ctx.maxPages over the entry max_pages');
  else fail(`yourator.fetch probe requests = ${JSON.stringify(probed)}`);

  // A malformed payload must throw, not silently return [].
  let threw = false;
  try {
    await yourator.fetch({ name: 'Yourator' }, { transport: 'http', fetchJson: async () => ({ error: 'nope' }) });
  } catch {
    threw = true;
  }
  if (threw) pass('yourator.fetch throws on a payload without payload.jobs');
  else fail('yourator.fetch did not throw on a malformed payload');
} catch (e) {
  fail(`yourator provider test crashed: ${e?.message}`);
}
