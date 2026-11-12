// tests/providers/amazon.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — amazon (amazon.jobs search.json)');

try {
  const amazon = (await import(pathToFileURL(join(ROOT, 'providers/amazon.mjs')).href)).default;

  if (amazon.id === 'amazon') pass('amazon.id is "amazon"');
  else fail(`amazon.id is ${JSON.stringify(amazon.id)}`);

  // detect() — host match, not path-spoof, https + non-string safe
  if (amazon.detect({ name: 'X', careers_url: 'https://www.amazon.jobs/en/search' })) pass('amazon.detect() claims an amazon.jobs URL');
  else fail('amazon.detect() should claim amazon.jobs');
  if (amazon.detect({ name: 'X', careers_url: 'https://evil.example/www.amazon.jobs/x' }) === null) pass('amazon.detect() rejects a path-spoofed URL');
  else fail('amazon.detect() must reject path-spoofed URLs');
  if (amazon.detect({ name: 'X', careers_url: 42 }) === null) pass('amazon.detect() returns null for non-string careers_url');
  else fail('amazon.detect() should return null for non-string careers_url');

  // fetch() with a mock ctx — captures the request URL (to assert facet
  // bracket-encoding) and returns a canned page, exercising the real mapping.
  const calls = [];
  const page1 = {
    jobs: [
      { title: '  Automation Engineer  ', job_path: '/en/jobs/111/automation-engineer', normalized_location: 'Erfurt, Thuringia, DEU', posted_date: 'July  1, 2026', updated_time: '10 minutes', company_name: 'Amazon' },
      { title: 'SDE', job_path: 'https://www.amazon.jobs/en/jobs/222/sde', location: 'Berlin, DEU', posted_date: 'June 29, 2026' },
      { title: 'No Path', normalized_location: 'X' }, // dropped — no job_path
    ],
  };
  const mockCtx = {
    transport: 'http',
    async fetchJson(url) { calls.push(url); return calls.length === 1 ? page1 : { jobs: [] }; },
    async fetchText() { return ''; },
  };
  const jobs = await amazon.fetch({ name: 'Amazon', amazon: { normalized_country_code: ['DEU'], base_query: 'engineer' } }, mockCtx);

  if (jobs.length === 2) pass('amazon.fetch maps valid jobs, drops job_path-less entries');
  else fail(`amazon.fetch returned ${jobs.length} jobs, expected 2`);
  if (calls[0] && calls[0].includes('normalized_country_code%5B%5D=DEU')) pass('amazon.fetch bracket-encodes array facets (normalized_country_code[]=DEU)');
  else fail(`amazon.fetch facet encoding wrong: ${calls[0]}`);
  if (calls[0] && calls[0].includes('result_limit=100')) pass('amazon.fetch requests result_limit=100');
  else fail('amazon.fetch should set result_limit=100');
  const j1 = jobs.find((j) => j.url.includes('/111/'));
  if (j1 && j1.title === 'Automation Engineer') pass('amazon.fetch trims the title');
  else fail(`amazon.fetch title wrong: ${JSON.stringify(j1 && j1.title)}`);
  if (j1 && j1.url === 'https://www.amazon.jobs/en/jobs/111/automation-engineer') pass('amazon.fetch builds an absolute URL from job_path');
  else fail(`amazon.fetch url wrong: ${JSON.stringify(j1 && j1.url)}`);
  if (j1 && j1.postedAt === Date.parse('July 1, 2026')) pass('amazon.fetch parses posted_date (ignores relative updated_time)');
  else fail(`amazon.fetch postedAt wrong: ${JSON.stringify(j1 && j1.postedAt)}`);
  const j2 = jobs.find((j) => j.url.includes('/222/'));
  if (j2 && j2.url === 'https://www.amazon.jobs/en/jobs/222/sde') pass('amazon.fetch keeps an already-absolute job_path');
  else fail(`amazon.fetch absolute url wrong: ${JSON.stringify(j2 && j2.url)}`);
  if (j2 && j2.location === 'Berlin, DEU') pass('amazon.fetch falls back to location when there is no locations array');
  else fail(`amazon.fetch fallback location wrong: ${JSON.stringify(j2 && j2.location)}`);

  // A multi-city req names one city in normalized_location; the rest are only
  // in `locations`, an array of JSON-encoded strings.
  const loc = (city, raw) => JSON.stringify({ normalizedLocation: city, location: raw });
  const multiPage = {
    jobs: [{
      title: 'Solutions Architect',
      job_path: '/en/jobs/333/solutions-architect',
      normalized_location: 'Seattle, Washington, USA',
      locations: [
        loc('Seattle, Washington, USA', 'US, WA, Seattle'), loc('Arlington, Virginia, USA', 'US, VA, Arlington'), '{not json',
        // A non-string normalizedLocation falls back to the raw spelling, and
        // the same city's later normalized entry is not listed a second time.
        JSON.stringify({ normalizedLocation: 123, location: 'US, CO, Denver' }),
        loc('Denver, Colorado, USA', 'US, CO, Denver'),
        // No usable string in either field: skipped.
        JSON.stringify({ normalizedLocation: null, location: 42 }),
      ],
    }, {
      // No normalized_location: the primary is the raw spelling, which must
      // still dedupe against the same city's normalized entry.
      title: 'Account Manager',
      job_path: '/en/jobs/444/account-manager',
      location: 'US, VA, Arlington',
      locations: [loc('Arlington, Virginia, USA', 'US, VA, Arlington'), loc('Herndon, Virginia, USA', 'US, VA, Herndon')],
    }],
  };
  let multiCalls = 0;
  const multiJobs = await amazon.fetch({ name: 'Amazon' }, {
    transport: 'http',
    async fetchJson(_url, opts) {
      if (opts?.redirect !== 'error') throw new Error(`fetchJson without redirect:'error': ${JSON.stringify(opts)}`);
      multiCalls++;
      return multiCalls === 1 ? multiPage : { jobs: [] };
    },
    async fetchText() { return ''; },
  });
  const j3 = multiJobs[0];
  if (j3 && j3.location === 'Seattle, Washington, USA · Arlington, Virginia, USA · US, CO, Denver') pass('amazon.fetch lists every city of a multi-city req, primary first, deduped, malformed and non-string entries handled');
  else fail(`amazon.fetch multi-city location wrong: ${JSON.stringify(j3 && j3.location)}`);
  const j4 = multiJobs[1];
  if (j4 && j4.location === 'US, VA, Arlington · Herndon, Virginia, USA') pass('amazon.fetch dedupes a raw-spelled primary against its normalized entry');
  else fail(`amazon.fetch raw-primary dedupe wrong: ${JSON.stringify(j4 && j4.location)}`);

  // A reported `hits` past the 20-page default is read in full (CA+NY board,
  // 3,171 postings, 2026-11-07), and the walk stops at the total.
  const HITS = 3171;
  let hitCalls = 0;
  const big = await amazon.fetch({ name: 'Amazon', amazon: { normalized_country_code: ['USA'] } }, {
    transport: 'http',
    async fetchJson(url) {
      hitCalls++;
      const off = Number(new URL(url).searchParams.get('offset') || 0);
      const n = Math.max(0, Math.min(100, HITS - off));
      return { hits: HITS, jobs: Array.from({ length: n }, (_, i) => ({ title: `R${off + i}`, job_path: `/en/jobs/${off + i}/r` })) };
    },
    async fetchText() { return ''; },
  });
  if (big.length === HITS && hitCalls === Math.ceil(HITS / 100) && !big.truncated) pass('amazon.fetch reads a 3,171-posting board past the 20-page default, untruncated');
  else fail(`amazon hits-bounded walk: ${big.length} jobs in ${hitCalls} calls, truncated=${JSON.stringify(big.truncated)}`);

  // Shared fake board for the cap cases below.
  const board = (hits, counter, withHits = true) => ({
    transport: 'http',
    async fetchJson(url) {
      counter.n++;
      const off = Number(new URL(url).searchParams.get('offset') || 0);
      const n = Math.max(0, Math.min(100, hits - off));
      const jobs = Array.from({ length: n }, (_, i) => ({ title: `R${off + i}`, job_path: `/en/jobs/${off + i}/r` }));
      return withHits ? { hits, jobs } : { jobs };
    },
    async fetchText() { return ''; },
  });
  const quiet = async (fn) => {
    const lines = []; const orig = console.error;
    console.error = (...a) => { lines.push(a.join(' ')); };
    try { return { result: await fn(), lines }; } finally { console.error = orig; }
  };

  // Past the 100-page ceiling: stop there and report the board partial.
  const hugeN = { n: 0 };
  const huge = await quiet(() => amazon.fetch({ name: 'Huge', amazon: {} }, board(25000, hugeN)));
  if (hugeN.n === 100 && huge.result.length === 10000 && huge.result.truncated?.reason === 'page-cap'
      && huge.result.truncated?.total === 25000 && huge.lines.length === 1 && huge.lines[0].includes('10000 of 25000'))
    pass('amazon.fetch stops at the 100-page ceiling and marks the board truncated');
  else fail(`amazon ceiling: ${hugeN.n} calls, ${huge.result.length} jobs, ${JSON.stringify(huge.result.truncated)}, ${JSON.stringify(huge.lines)}`);

  // No `hits` in the response: the 20-page default still bounds the walk, and says so.
  const noHitsN = { n: 0 };
  const noHits = await quiet(() => amazon.fetch({ name: 'NoHits', amazon: {} }, board(5000, noHitsN, false)));
  if (noHitsN.n === 20 && noHits.result.length === 2000 && noHits.result.truncated?.reason === 'page-cap' && noHits.lines.length === 1)
    pass('amazon.fetch keeps the 20-page default when the API reports no hits, and marks the cut');
  else fail(`amazon no-hits default: ${noHitsN.n} calls, ${noHits.result.length} jobs, ${JSON.stringify(noHits.lines)}`);

  // `hits` understates the board (2,000 reported, 2,500 real): the budget is
  // one page past hits, the walk ends on a full page, and that is partial.
  const underN = { n: 0 };
  const underCtx = board(2500, underN);
  const realFetch = underCtx.fetchJson;
  underCtx.fetchJson = async (url) => ({ ...(await realFetch(url)), hits: 2000 });
  const under = await quiet(() => amazon.fetch({ name: 'Under', amazon: {} }, underCtx));
  if (underN.n === 21 && under.result.length === 2100 && under.result.truncated?.reason === 'page-cap' && under.lines.length === 1)
    pass('amazon.fetch never treats an understated hits as the end: reads one page past it and marks the cut');
  else fail(`amazon understated hits: ${underN.n} calls, ${under.result.length} jobs, ${JSON.stringify(under.result.truncated)}, ${JSON.stringify(under.lines)}`);

  // A board that is an exact multiple of the page size ends on an observed empty page, untruncated.
  const exactN = { n: 0 };
  const exact = await quiet(() => amazon.fetch({ name: 'Exact', amazon: {} }, board(3000, exactN)));
  if (exactN.n === 31 && exact.result.length === 3000 && !exact.result.truncated && exact.lines.length === 0)
    pass('amazon.fetch reads an exact-multiple board to its empty page, untruncated');
  else fail(`amazon exact multiple: ${exactN.n} calls, ${exact.result.length} jobs, ${JSON.stringify(exact.lines)}`);

  // A health probe (ctx.maxPages = 1) reads one page and is not a truncation.
  const probeN = { n: 0 };
  const probe = await quiet(() => amazon.fetch({ name: 'Probe', amazon: {} }, { ...board(3171, probeN), maxPages: 1 }));
  if (probeN.n === 1 && probe.result.length === 100 && !probe.result.truncated && probe.lines.length === 0)
    pass('amazon.fetch honours ctx.maxPages for a probe, silently');
  else fail(`amazon probe: ${probeN.n} calls, ${probe.result.length} jobs, ${JSON.stringify(probe.lines)}`);
} catch (e) {
  fail(`amazon provider tests crashed: ${e.message}`);
}

