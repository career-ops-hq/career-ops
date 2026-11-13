// tests/providers/freelancer-com.test.mjs — provider-contract tests for the
// Freelancer.com public projects API provider (providers/freelancer-com.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — freelancer-com');

/** @param {number} n @param {number} [start] */
function makeProjects(n, start = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: start + i,
    title: `Project ${start + i}`,
    seo_url: `python/Project-${start + i}`,
    type: 'fixed',
    local: false,
    time_submitted: 1790000000 + i,
  }));
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/freelancer-com.mjs')).href);
  const provider = mod.default;
  const { parseFreelancerProjects, parseQueries, buildSearchUrl } = mod;

  if (provider.id === 'freelancer-com') pass('freelancer-com.id is "freelancer-com"');
  else fail(`freelancer-com.id is ${JSON.stringify(provider.id)}`);

  // detect() — explicit-only
  const hit = provider.detect({ name: 'Acme', provider: 'freelancer-com' });
  if (hit && hit.url === 'https://www.freelancer.com/api/projects/0.1/projects/active/') pass('detect() claims provider:freelancer-com with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (provider.detect({ name: 'X', careers_url: 'https://www.freelancer.com/jobs/' }) === null && provider.detect(null) === null && provider.detect({ provider: 'gulp' }) === null) {
    pass('detect() returns null without provider:freelancer-com');
  } else fail('detect() should be explicit-only');

  // parseQueries
  const q = parseQueries({ queries: ['  LLM ', 'LLM', '', 7, 'AI agent'] });
  if (JSON.stringify(q) === JSON.stringify(['LLM', 'AI agent'])) pass('parseQueries trims, dedups, drops junk');
  else fail(`parseQueries = ${JSON.stringify(q)}`);
  if (JSON.stringify(parseQueries({})) === JSON.stringify([''])) pass('parseQueries defaults to one unfiltered pass');
  else fail(`parseQueries default = ${JSON.stringify(parseQueries({}))}`);
  if (parseQueries({ queries: Array.from({ length: 50 }, (_, i) => `q${i}`) }).length === 20) pass('parseQueries caps the query list at 20');
  else fail('parseQueries should cap at 20');

  const u = new URL(buildSearchUrl('machine learning', 200));
  if (u.hostname === 'www.freelancer.com' && u.searchParams.get('query') === 'machine learning' && u.searchParams.get('offset') === '200' && u.searchParams.get('limit') === '100') {
    pass('buildSearchUrl sets query/offset/limit on the fixed API host');
  } else fail(`buildSearchUrl = ${u.href}`);
  if (!new URL(buildSearchUrl('', 0)).searchParams.has('query')) pass('buildSearchUrl omits an empty query');
  else fail('empty query should be omitted');

  // parseFreelancerProjects — normalization
  const sample = {
    status: 'success',
    result: {
      total_count: 5,
      projects: [
        {
          id: 1, title: ' LLM Agent Builder ', seo_url: 'python/LLM-Agent-Builder', type: 'hourly', local: false,
          time_submitted: 1793197125, language: 'en',
          budget: { minimum: 30, maximum: 50 }, currency: { code: 'USD' },
          jobs: [{ name: 'Python' }, { name: 'LangChain' }], upgrades: { fulltime: true },
          preview_description: 'Build an agent.',
        },
        { id: 2, title: 'Local Gig', seo_url: 'data-entry/Local-Gig', type: 'fixed', local: true, location: { city: 'Exampletown', country: { name: 'Canada' } }, budget: { minimum: 100 } },
        { id: 3, title: 'Deleted', seo_url: 'x/Deleted', deleted: true },
        { id: 4, title: '', seo_url: 'x/No-Title' },
        { id: 5, title: 'Bad slug', seo_url: 'x/\uD800bad' },
        { id: 6, title: 'Traversal', seo_url: '../etc' },
        null,
      ],
    },
  };
  const parsed = parseFreelancerProjects(sample);
  if (parsed.jobs.length === 2 && parsed.rawCount === 7 && parsed.total === 5) pass('parseFreelancerProjects keeps 2 valid rows, rawCount counts all source rows');
  else fail(`parsed = ${JSON.stringify({ n: parsed.jobs.length, raw: parsed.rawCount, total: parsed.total })}`);
  const [a, b] = parsed.jobs;
  if (a?.title === 'LLM Agent Builder' && a.url === 'https://www.freelancer.com/projects/python/LLM-Agent-Builder' && a.company === 'Freelancer.com client' && a.location === 'Remote') {
    pass('row 0: title trimmed, project URL built from seo_url, anonymous client label, non-local → Remote');
  } else fail(`row 0 = ${JSON.stringify(a)}`);
  if (a?.description.startsWith('Engagement: freelance') && a.description.includes('Budget: 30–50 USD per hour') && a.description.includes('Full-time: yes') && a.description.includes('Skills: Python, LangChain')) {
    pass('row 0 description carries engagement, the source budget, full-time flag and skills');
  } else fail(`row 0 description = ${JSON.stringify(a?.description)}`);
  if (a?.postedAt === 1793197125000 && a.language === 'en') pass('row 0 postedAt from time_submitted (s → ms), language kept');
  else fail(`row 0 postedAt/language = ${a?.postedAt}/${a?.language}`);
  if (b?.location === 'Exampletown, Canada' && b.description.includes('Budget: 100') && !b.description.includes('undefined') && b.postedAt === undefined) {
    pass('row 1: local project keeps the API city/country; no invented budget or date');
  } else fail(`row 1 = ${JSON.stringify(b)}`);

  // Empty vs broken
  const empty = parseFreelancerProjects({ status: 'success', result: { projects: [], total_count: 0 } });
  if (empty.jobs.length === 0) pass('present-and-empty projects[] → []');
  else fail('empty projects[] should yield []');
  for (const [label, body] of [['{}', {}], ['error body', { status: 'error', message: 'rate limited' }], ['projects:null', { status: 'success', result: { projects: null } }], ['string', 'oops'], ['null', null]]) {
    try { parseFreelancerProjects(body); fail(`parseFreelancerProjects(${label}) should throw`); }
    catch (e) {
      if (/freelancer-com: unexpected response/.test(e.message)) pass(`parseFreelancerProjects(${label}) throws a descriptive error`);
      else fail(`parseFreelancerProjects(${label}) threw ${e.message}`);
    }
  }

  // fetch() — pagination, redirect:'error', DEFAULT_MAX_PAGES
  {
    const calls = [];
    const ctx = {
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        const offset = Number(new URL(url).searchParams.get('offset'));
        return { status: 'success', result: { total_count: 100000, projects: makeProjects(100, offset) } };
      },
    };
    const origWarn = console.warn; const warns = [];
    console.warn = (m) => warns.push(String(m));
    let jobs;
    try { jobs = await provider.fetch({ name: 'Acme', provider: 'freelancer-com' }, ctx); }
    finally { console.warn = origWarn; }
    if (calls.length === 3 && jobs.length === 300) pass('fetch() stops at DEFAULT_MAX_PAGES (3) even when the source reports more');
    else fail(`fetch() made ${calls.length} calls, ${jobs.length} jobs`);
    if (calls.every(c => c.opts?.redirect === 'error' && c.url.startsWith('https://www.freelancer.com/api/projects/0.1/projects/active/'))) pass('every request passes redirect:\'error\' to the fixed API host');
    else fail(`opts = ${JSON.stringify(calls.map(c => c.opts))}`);
    if (warns.some(w => /raise max_pages/.test(w))) pass('a full page at the ceiling warns to raise max_pages');
    else fail(`warns = ${JSON.stringify(warns)}`);
  }

  // A short page ends the walk without a cap warning
  {
    let n = 0;
    const ctx = { sleep: async () => {}, fetchJson: async () => { n++; return { status: 'success', result: { total_count: 130, projects: makeProjects(n === 1 ? 100 : 30, n * 100) } }; } };
    const origWarn = console.warn; const warns = [];
    console.warn = (m) => warns.push(String(m));
    let jobs;
    try { jobs = await provider.fetch({ name: 'Acme', provider: 'freelancer-com', max_pages: 10 }, ctx); }
    finally { console.warn = origWarn; }
    if (n === 2 && jobs.length === 130 && !warns.length) pass('a short final page ends the walk, no max_pages warning');
    else fail(`short page: ${n} calls, ${jobs.length} jobs, warns ${JSON.stringify(warns)}`);
  }

  // Probe: exactly one list request, rejection propagates unwrapped
  {
    let n = 0;
    const ctx = { maxPages: 1, sleep: async () => {}, fetchJson: async () => { n++; return { status: 'success', result: { total_count: 9999, projects: makeProjects(100) } }; } };
    await provider.fetch({ name: 'Acme', provider: 'freelancer-com', queries: ['a', 'b', 'c'] }, ctx);
    if (n === 1) pass('ctx.maxPages:1 → exactly one list request across all queries');
    else fail(`probe made ${n} requests`);
    class ProbePageBudgetReached extends Error {}
    const sentinel = new ProbePageBudgetReached('budget');
    try {
      await provider.fetch({ name: 'Acme', provider: 'freelancer-com' }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw sentinel; } });
      fail('probe rejection should propagate');
    } catch (e) {
      if (e === sentinel) pass('a ctx.fetch* rejection under the probe propagates unwrapped');
      else fail(`probe rejection rewrapped: ${e?.message}`);
    }
  }

  // Fetch error on page 2: keep page 1, warn, no max_pages warning
  {
    let n = 0;
    const err503 = Object.assign(new Error('HTTP 503'), { status: 503 });
    const ctx = { sleep: async () => {}, fetchJson: async () => { n++; if (n === 1) return { status: 'success', result: { total_count: 9999, projects: makeProjects(100) } }; throw err503; } };
    const origWarn = console.warn; const warns = [];
    console.warn = (m) => warns.push(String(m));
    let jobs;
    try { jobs = await provider.fetch({ name: 'Acme', provider: 'freelancer-com', max_pages: 2 }, ctx); }
    finally { console.warn = origWarn; }
    if (jobs.length === 100 && warns.some(w => /failed/.test(w)) && !warns.some(w => /raise max_pages/.test(w))) {
      pass('a page-2 failure that retry cannot clear keeps page 1 and warns, without the max_pages warning');
    } else fail(`fetch-error: ${jobs.length} jobs, warns ${JSON.stringify(warns)}`);
  }

  // Every query failing → loud
  {
    const ctx = { sleep: async () => {}, fetchJson: async () => ({ status: 'error', message: 'nope' }) };
    const origWarn = console.warn; console.warn = () => {};
    try { await provider.fetch({ name: 'Acme', provider: 'freelancer-com' }, ctx); fail('all-queries-failed should throw'); }
    catch (e) { if (/unexpected response/.test(e.message)) pass('an envelope change on every query throws instead of returning []'); else fail(e.message); }
    finally { console.warn = origWarn; }
  }
} catch (e) {
  fail(`freelancer-com provider tests crashed: ${e.stack || e.message}`);
}
