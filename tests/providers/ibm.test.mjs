// tests/providers/ibm.test.mjs — moved from test-all.mjs (#1440); pagination
// cases follow providers/ADDING_A_PROVIDER.md section 2.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — ibm');

try {
  const ibmModule = await import(pathToFileURL(join(ROOT, 'providers/ibm.mjs')).href);
  const ibm = ibmModule.default;
  const { parseIbmResponse, buildPostFilter } = ibmModule;

  if (ibm.id === 'ibm') pass('ibm.id is "ibm"');
  else fail(`ibm.id is ${JSON.stringify(ibm.id)}`);

  // buildPostFilter — empty config yields no filter terms
  if (buildPostFilter({}).bool.must.length === 0) pass('buildPostFilter({}) → no must terms');
  else fail(`buildPostFilter({}) = ${JSON.stringify(buildPostFilter({}))}`);

  // buildPostFilter — country + categories produce the expected facet terms
  const pf = buildPostFilter({ country: 'Germany', categories: ['Software Engineering', 'Data & Analytics'] });
  const countryTerm = pf.bool.must.find(m => m.term && m.term.field_keyword_05);
  const catTerm = pf.bool.must.find(m => m.bool && m.bool.should);
  if (countryTerm?.term.field_keyword_05 === 'Germany' && catTerm?.bool.should.length === 2) {
    pass('buildPostFilter maps country → field_keyword_05 and categories → field_keyword_08 should[]');
  } else {
    fail(`buildPostFilter facets = ${JSON.stringify(pf)}`);
  }

  // buildPostFilter — sanitizes empty/non-string category entries
  const sanitized = buildPostFilter({ categories: ['Valid', '', '   ', 42, null] });
  const sanitizedShould = sanitized.bool.must.find(m => m.bool && m.bool.should)?.bool.should;
  if (sanitizedShould?.length === 1 && sanitizedShould[0].term.field_keyword_08 === 'Valid') {
    pass('buildPostFilter drops empty/non-string category entries');
  } else {
    fail(`buildPostFilter sanitization = ${JSON.stringify(sanitizedShould)}`);
  }

  // parseIbmResponse — happy path, location assembled from keyword_19 · keyword_17
  const sample = {
    hits: {
      hits: [
        { _source: { title: 'ML Engineer', url: 'https://ibm.com/careers/1', field_keyword_19: 'Berlin, Germany', field_keyword_17: 'Hybrid' } },
        { _source: { title: 'Data Scientist', url: 'https://ibm.com/careers/2', field_keyword_19: 'Remote' } },
      ],
    },
  };
  const jobs = parseIbmResponse(sample);
  if (jobs.length === 2 && jobs[0].company === 'IBM') pass('parseIbmResponse extracts 2 jobs with company "IBM"');
  else fail(`parseIbmResponse returned ${JSON.stringify(jobs)}`);

  if (jobs[0].location === 'Berlin, Germany · Hybrid') pass('parseIbmResponse joins location · work mode');
  else fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);

  if (jobs[1].location === 'Remote') pass('parseIbmResponse omits the separator when work mode is absent');
  else fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}`);

  // parseIbmResponse — drops title-less, url-less, and non-http(s) entries
  const dirty = parseIbmResponse({
    hits: {
      hits: [
        { _source: { title: '', url: 'https://ibm.com/careers/3' } },
        { _source: { title: 'No URL' } },
        { _source: { title: 'Bad scheme', url: 'ftp://ibm.com/careers/4' } },
        { _source: { title: 'Good', url: 'https://ibm.com/careers/5' } },
      ],
    },
  });
  if (dirty.length === 1 && dirty[0].title === 'Good') pass('parseIbmResponse drops title-less, url-less, and non-http(s) entries');
  else fail(`parseIbmResponse dirty = ${JSON.stringify(dirty)}`);

  // parseIbmResponse — throws on unexpected shape (endpoint drift surfaces loudly)
  let drifted = false;
  try { parseIbmResponse({ results: [] }); } catch { drifted = true; }
  if (drifted) pass('parseIbmResponse throws when hits.hits[] is missing');
  else fail('parseIbmResponse should throw on unexpected API response shape');

  // fetch() — paginates until a short page, via mock ctx
  let calls = 0;
  const mockCtx = {
    fetchJson: async (url, opts) => {
      calls++;
      if (url !== 'https://www-api.ibm.com/search/api/v2') throw new Error(`unexpected url ${url}`);
      if (opts?.method !== 'POST') throw new Error('Expected POST');
      // Page 1: a full page (30 hits) → keep paging; page 2: short page → stop.
      const n = calls === 1 ? 30 : 2;
      const hits = Array.from({ length: n }, (_, i) => ({
        _source: { title: `Role ${calls}-${i}`, url: `https://ibm.com/careers/${calls}-${i}` },
      }));
      return { hits: { hits } };
    },
  };
  let sleeps = 0;
  mockCtx.sleep = async () => { sleeps++; };
  const fetched = await ibm.fetch({ name: 'IBM', ibm: { country: 'Germany' } }, mockCtx);
  if (calls === 2 && fetched.length === 32) pass('ibm.fetch() paginates and stops on the first short page');
  else fail(`ibm.fetch() made ${calls} calls, returned ${fetched.length} jobs`);
  if (sleeps === 1) pass('ibm.fetch() pauses between pages, not before the first');
  else fail(`ibm.fetch() slept ${sleeps} times for 2 pages`);

  // A board that never returns a short page. `fail` makes the given 0-based
  // calls throw, with `status` set as ctx.fetchJson's HTTP errors carry it.
  const fullBoard = ({ failOn = {}, maxPages } = {}) => {
    const state = { calls: 0, ctx: null };
    state.ctx = {
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        const n = state.calls++;
        if (failOn[n] !== undefined) {
          const err = new Error(`HTTP ${failOn[n]}`);
          /** @type {any} */ (err).status = failOn[n];
          throw err;
        }
        const from = JSON.parse(opts.body).from;
        return { hits: { hits: Array.from({ length: 30 }, (_, i) => ({ _source: { title: `Role ${from + i}`, url: `https://ibm.com/careers/${from + i}` } })) } };
      },
    };
    if (maxPages !== undefined) state.ctx.maxPages = maxPages;
    return state;
  };
  const captureStderr = async (fn) => {
    const orig = console.error;
    const lines = [];
    console.error = (...a) => { lines.push(a.join(' ')); };
    try { return { result: await fn(), lines }; } finally { console.error = orig; }
  };

  // resolveMaxPages — default, entry override, hard ceiling, junk.
  const { resolveMaxPages } = ibmModule;
  if (resolveMaxPages({}) === 20 && resolveMaxPages({ max_pages: 3 }) === 3 && resolveMaxPages({ max_pages: 5000 }) === 300
    && resolveMaxPages({ max_pages: -1 }) === 20 && resolveMaxPages({ max_pages: '7' }) === 20) {
    pass('resolveMaxPages: default 20, entry override, 300 ceiling, junk ignored');
  } else {
    fail(`resolveMaxPages = ${[{}, { max_pages: 3 }, { max_pages: 5000 }, { max_pages: -1 }, { max_pages: '7' }].map(resolveMaxPages).join(',')}`);
  }

  // The liveness probe: exactly one list request, no truncation warning.
  const probe = fullBoard({ maxPages: 1 });
  const probed = await captureStderr(() => ibm.fetch({ name: 'IBM' }, probe.ctx));
  if (probe.calls === 1 && probed.result.length === 30 && probed.lines.length === 0) pass('ctx.maxPages: 1 makes exactly one list request and warns nothing');
  else fail(`probe made ${probe.calls} calls, ${probed.result.length} jobs, stderr ${JSON.stringify(probed.lines)}`);

  // The entry's own cap on a full board: stops there and says to raise it.
  const capped = fullBoard();
  const cappedRun = await captureStderr(() => ibm.fetch({ name: 'IBM', max_pages: 3 }, capped.ctx));
  if (capped.calls === 3 && cappedRun.result.length === 90 && cappedRun.lines.some((l) => l.includes('raise max_pages'))) {
    pass('a full board stops at max_pages and warns to raise it');
  } else {
    fail(`capped run made ${capped.calls} calls, ${cappedRun.result.length} jobs, stderr ${JSON.stringify(cappedRun.lines)}`);
  }

  // A board that ends exactly at the cap with a short page is complete.
  let shortCalls = 0;
  const shortAtCap = await captureStderr(() => ibm.fetch({ name: 'IBM', max_pages: 2 }, {
    sleep: async () => {},
    fetchJson: async () => {
      const n = ++shortCalls === 1 ? 30 : 5;
      return { hits: { hits: Array.from({ length: n }, (_, i) => ({ _source: { title: `R${shortCalls}-${i}`, url: `https://ibm.com/careers/${shortCalls}-${i}` } })) } };
    },
  }));
  if (shortCalls === 2 && shortAtCap.result.length === 35 && shortAtCap.lines.length === 0) pass('a short page at the cap is a complete board, not a truncation');
  else fail(`short-at-cap made ${shortCalls} calls, stderr ${JSON.stringify(shortAtCap.lines)}`);

  // A transient 503 is retried, not fatal.
  const flaky = fullBoard({ failOn: { 0: 503 } });
  const flakyRun = await captureStderr(() => ibm.fetch({ name: 'IBM', max_pages: 1 }, flaky.ctx));
  if (flaky.calls === 2 && flakyRun.result.length === 30) pass('a 503 on a page is retried');
  else fail(`flaky run made ${flaky.calls} calls, returned ${flakyRun.result.length} jobs`);

  // A later page that keeps failing keeps the earlier pages and says why.
  const brokenLater = fullBoard({ failOn: { 1: 404 } });
  const laterRun = await captureStderr(() => ibm.fetch({ name: 'IBM', max_pages: 5 }, brokenLater.ctx));
  if (laterRun.result.length === 30 && laterRun.lines.some((l) => l.includes('truncated at page 2')) && !laterRun.lines.some((l) => l.includes('raise max_pages'))) {
    pass('a failed later page keeps earlier pages and warns without blaming max_pages');
  } else {
    fail(`later-failure run returned ${laterRun.result.length} jobs, stderr ${JSON.stringify(laterRun.lines)}`);
  }

  // A failed first page throws: an empty list would read as "no postings".
  let firstThrew = false;
  try { await ibm.fetch({ name: 'IBM' }, fullBoard({ failOn: { 0: 404 } }).ctx); } catch { firstThrew = true; }
  if (firstThrew) pass('a failed first page throws instead of returning []');
  else fail('a failed first page returned a result');

  // Under a probe cap, a rejection reaches the caller unwrapped.
  class ProbeStop extends Error {}
  const sentinel = new ProbeStop('budget');
  let caught = null;
  try {
    await ibm.fetch({ name: 'IBM' }, { maxPages: 2, sleep: async () => {}, fetchJson: async (_u, opts) => {
      if (JSON.parse(opts.body).from > 0) throw sentinel;
      return { hits: { hits: Array.from({ length: 30 }, (_, i) => ({ _source: { title: `P${i}`, url: `https://ibm.com/careers/p${i}` } })) } };
    } });
  } catch (err) { caught = err; }
  if (caught === sentinel) pass('under ctx.maxPages a page rejection propagates unwrapped');
  else fail(`probe rejection came back as ${caught === null ? 'no error' : caught?.message}`);

} catch (e) {
  fail(`ibm provider tests crashed: ${e.message}`);
}

