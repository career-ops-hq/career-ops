// #2380: scan --verify must use the existing ATS API rung before loading
// Playwright. Exercise the real API/browser classifiers without network or a
// Chromium installation; only the transport objects are replaced.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyOffers } from '../scan.mjs';

const offer = (url, extra = {}) => ({ company: 'Example', title: 'Platform Engineer', url, ...extra });
const active = { result: 'active', code: 'greenhouse_api_ok', reason: 'Posting is live' };
const gone = { result: 'expired', code: 'greenhouse_api_gone', reason: 'ATS API 404 — posting removed' };
const uncertain = { result: 'uncertain', code: 'linkedin_ambiguous', reason: 'Posting could not be classified' };
const body = 'Build reliable services with our platform engineering team. '.repeat(12);
const urls = (offers) => offers.map((item) => item.url);
const noBrowser = async () => { throw new Error('Playwright must not be imported for this batch'); };

function browserHarness(fixtures = {}, { searchResults = [], searchRedirect = null, pageError = null } = {}) {
  const state = { loads: 0, launches: [], closes: 0, navigations: [], abortedRequests: [], inFlight: 0, maxInFlight: 0 };
  const chromium = {
    async launch({ headless }) {
      state.launches.push(headless);
      let current = 'about:blank';
      let fixture = {};
      let guarded = false;
      let routeHandler;
      const page = {
        async route(_pattern, handler) { guarded = true; routeHandler = handler; },
        async goto(url) {
          current = url;
          state.navigations.push({ url, headless, guarded, at: Date.now() });
          state.inFlight += 1;
          state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
          try {
            await Promise.resolve();
            if (url === 'about:blank' || url.startsWith('https://html.duckduckgo.com/html/?')) {
              fixture = {};
              if (url !== 'about:blank' && searchRedirect && routeHandler) {
                let aborted = false;
                await routeHandler({
                  request: () => ({ url: () => searchRedirect }),
                  async abort() { aborted = true; state.abortedRequests.push(searchRedirect); },
                  async continue() {},
                });
                if (aborted) throw new Error('search redirect blocked');
              }
              return { status: () => 200 };
            }
            const value = fixtures[url];
            assert.ok(value, `missing browser fixture for ${url}`);
            fixture = typeof value === 'function' ? value(headless) : value;
            if (fixture.error) throw new Error(fixture.error);
            return { status: () => fixture.status ?? 200 };
          } finally {
            state.inFlight -= 1;
          }
        },
        async waitForTimeout() {},
        url: () => fixture.finalUrl || current,
        async evaluate(fn) {
          const source = String(fn);
          if (source.includes('a.result__a')) return searchResults;
          if (source.includes('document.body')) return fixture.body ?? body;
          return fixture.controls ?? ['Apply now'];
        },
      };
      return {
        async newContext() {
          return { async newPage() {
            if (pageError) throw pageError;
            return page;
          } };
        },
        async close() { state.closes += 1; },
      };
    },
  };
  return {
    state,
    async loadPlaywright() {
      state.loads += 1;
      return { chromium };
    },
  };
}

await test('API-only batches use real ATS responses without importing Playwright', async () => {
  const items = [
    offer('https://boards.greenhouse.io/example/jobs/101'),
    offer('https://boards.greenhouse.io/example/jobs/102'),
    offer('https://jobs.ashbyhq.com/example/missing-role'),
  ];
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(String(url));
    assert.equal(init.redirect, 'error', 'the API rung retains its redirect safety boundary');
    if (String(url).endsWith('/jobs/101')) return new Response('{}', { status: 200 });
    if (String(url).endsWith('/jobs/102')) return new Response('', { status: 404 });
    assert.equal(String(url), 'https://api.ashbyhq.com/posting-api/job-board/example');
    return new Response('{"jobs":[]}', { status: 200 });
  };
  try {
    const result = await verifyOffers(items, { headedFallback: true, throttleBaseMs: 10_000 }, { loadPlaywright: noBrowser });
    assert.deepEqual(urls(result.verified), [items[0].url]);
    assert.deepEqual(urls(result.expired), [items[1].url, items[2].url]);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.invalid, []);
    assert.equal(requests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('empty batches and terminal API uncertainty need no browser', async () => {
  let calls = 0;
  const dependencies = { checkApi: async () => { calls += 1; return uncertain; }, loadPlaywright: noBrowser };
  const empty = await verifyOffers([], {}, dependencies);
  assert.deepEqual(empty, { verified: [], expired: [], dropped: [], invalid: [], migrated: [], verificationStatusByOffer: new Map() });
  assert.equal(calls, 0);
  const item = offer('https://www.linkedin.com/jobs/view/123');
  const result = await verifyOffers([item], {}, dependencies);
  assert.deepEqual(result.verified, [item], 'terminal API uncertainty stays a conservative passthrough');
  assert.equal(calls, 1);
});

await test('API checks have bounded concurrency and retain input order', async () => {
  const items = Array.from({ length: 23 }, (_, i) => offer(`https://example.com/jobs/${i}`));
  let inFlight = 0;
  let maxInFlight = 0;
  const completionOrder = [];
  const result = await verifyOffers(items, {}, {
    async checkApi(url) {
      const index = Number(url.split('/').at(-1));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, index % 2 === 0 ? 6 : 1));
      completionOrder.push(index);
      inFlight -= 1;
      return active;
    },
    loadPlaywright: noBrowser,
  });
  assert.ok(maxInFlight > 1, 'API checks should overlap instead of serializing every request');
  assert.ok(maxInFlight <= 10, `API checks exceeded the scanner limit: ${maxInFlight}`);
  assert.notDeepEqual(completionOrder, items.map((_, i) => i), 'fixture finishes out of order');
  assert.deepEqual(result.verified, items, 'async completion order must not reorder the pipeline');
});

await test('guards reject unsafe URLs before an API call or browser import', async () => {
  const items = [
    offer('not a URL'),
    offer('file:///tmp/posting?gh_jid=123'),
    offer('https://127.0.0.1/jobs?gh_jid=123'),
    offer('https://[::1]/jobs?gh_jid=123'),
    offer('https://169.254.169.254/jobs?gh_jid=123'),
  ];
  let calls = 0;
  const result = await verifyOffers(items, {}, {
    checkApi: async () => { calls += 1; return active; },
    loadPlaywright: noBrowser,
  });
  assert.equal(calls, 0, 'even an embedded ATS id must not bypass the original URL guard');
  assert.deepEqual(urls(result.invalid), urls(items));
  assert.deepEqual(result.invalid.map((item) => item.code), [
    'invalid_url', 'unsupported_protocol', 'blocked_host', 'blocked_host', 'blocked_host',
  ]);
  assert.deepEqual(result.verified, []);
});

await test('null and thrown API checks fall back sequentially and preserve browser classifications', async () => {
  const items = ['api', 'live', 'gone', 'no-apply', 'timeout'].map((id) => offer(`https://example.com/jobs/${id}`));
  const harness = browserHarness({
    [items[1].url]: {},
    [items[2].url]: { status: 410 },
    [items[3].url]: { controls: [] },
    [items[4].url]: { error: 'navigation timed out' },
  });
  const result = await verifyOffers(items, {}, {
    async checkApi(url) {
      if (url === items[0].url) return active;
      if (url === items[1].url) throw new Error('unexpected provider error');
      return null;
    },
    loadPlaywright: harness.loadPlaywright,
  });
  assert.deepEqual(urls(result.verified), [items[0].url, items[1].url, items[4].url]);
  assert.deepEqual(urls(result.expired), [items[2].url]);
  assert.deepEqual(urls(result.dropped), [items[3].url]);
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(harness.state.navigations.map((item) => item.url), urls(items.slice(1)));
  assert.equal(harness.state.maxInFlight, 1, 'Playwright must remain sequential');
  assert.equal(harness.state.loads, 1);
  assert.deepEqual(harness.state.launches, [true]);
  assert.equal(harness.state.closes, 1);
});

await test('real API throttling errors, server errors, and network failures reach the browser', async () => {
  const items = [201, 202, 203].map((id) => offer(`https://boards.greenhouse.io/example/jobs/${id}`));
  const harness = browserHarness(Object.fromEntries(items.map((item) => [item.url, {}])));
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith('/201')) return new Response('', { status: 429 });
    if (String(url).endsWith('/202')) return new Response('', { status: 503 });
    throw new Error('network unavailable');
  };
  try {
    const result = await verifyOffers(items, {}, { loadPlaywright: harness.loadPlaywright });
    assert.deepEqual(result.verified, items);
    assert.equal(requested.length, items.length);
    assert.deepEqual(harness.state.navigations.map((item) => item.url), urls(items));
    assert.deepEqual(result.expired, []);
    assert.equal(harness.state.closes, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('browser import and launch failures remain actionable; page failures close the browser', async () => {
  const items = [offer('https://example.com/jobs/one')];
  const checkApi = async () => null;
  await assert.rejects(verifyOffers(items, {}, {
    checkApi,
    loadPlaywright: async () => { throw new Error('package missing'); },
  }), /--verify requires Playwright with Chromium.*npx playwright install chromium.*package missing/);
  await assert.rejects(verifyOffers(items, {}, {
    checkApi,
    loadPlaywright: async () => ({ chromium: { launch: async () => { throw new Error('executable missing'); } } }),
  }), /--verify could not launch Chromium.*npx playwright install chromium.*executable missing/);
  const harness = browserHarness({}, { pageError: new Error('page creation failed') });
  await assert.rejects(verifyOffers(items, {}, { checkApi, loadPlaywright: harness.loadPlaywright }), /page creation failed/);
  assert.equal(harness.state.closes, 1, 'a launched browser must close if page initialization fails');
});

await test('headed fallback stays lazy and cleans up both browsers after a challenge', async () => {
  const item = offer('https://example.com/jobs/challenge');
  const harness = browserHarness({ [item.url]: (headless) => headless ? { status: 403 } : {} });
  const result = await verifyOffers([item], { headedFallback: true }, {
    checkApi: async () => null,
    loadPlaywright: harness.loadPlaywright,
  });
  assert.deepEqual(result.verified, [item]);
  assert.deepEqual(harness.state.launches, [true, false]);
  assert.deepEqual(harness.state.navigations.map(({ headless }) => headless), [true, false]);
  assert.equal(harness.state.closes, 2);
});

await test('API HTTP-gone rediscovery verifies the new URL and still throttles the next browser offer', async () => {
  const old = offer('https://example.com/jobs/old', { tracked: true, careersUrlDomain: 'example.com' });
  const next = offer('https://example.com/jobs/next');
  const newUrl = 'https://example.com/jobs/moved';
  const harness = browserHarness({ [newUrl]: {}, [next.url]: {} }, { searchResults: [newUrl] });
  const result = await verifyOffers([old, next], { rediscover: true, throttleBaseMs: 25 }, {
    async checkApi(url) {
      if (url === old.url) return { ...gone, code: 'greenhouse-embedded_api_gone' };
      return null;
    },
    loadPlaywright: harness.loadPlaywright,
  });
  assert.deepEqual(result.migrated, [{ ...old, url: newUrl, previousUrl: old.url }]);
  assert.deepEqual(result.verified, [next]);
  assert.deepEqual(result.expired, []);
  const navigation = harness.state.navigations;
  assert.ok(navigation[0].url.startsWith('https://html.duckduckgo.com/html/?'));
  assert.equal(navigation[0].guarded, true, 'the first search must install the request guard before navigating');
  assert.ok(navigation.some(({ url }) => url === newUrl), 'a discovered URL requires a live browser recheck');
  assert.equal(navigation.at(-1).url, next.url);
  assert.ok(navigation.at(-1).at - navigation[0].at >= 24, 'migration must not skip browser throttling');
  assert.equal(harness.state.loads, 1);
  assert.equal(harness.state.closes, 1);
});

await test('rediscovery only handles HTTP-gone, and an uncertain replacement never migrates', async () => {
  const old = offer('https://example.com/jobs/old', { tracked: true, careersUrlDomain: 'example.com' });
  const soft = offer('https://example.com/jobs/unlisted', { tracked: true, careersUrlDomain: 'example.com' });
  const untracked = offer('https://example.com/jobs/untracked');
  const newUrl = 'https://example.com/jobs/replacement';
  const harness = browserHarness({ [newUrl]: { status: 503 } }, { searchResults: [newUrl] });
  const result = await verifyOffers([old, soft, untracked], { rediscover: true }, {
    async checkApi(url) {
      if (url === soft.url) return { ...gone, code: 'ashby_api_unlisted' };
      return gone;
    },
    loadPlaywright: harness.loadPlaywright,
  });
  assert.deepEqual(result.migrated, []);
  assert.deepEqual(urls(result.expired), [old.url, soft.url, untracked.url]);
  assert.equal(harness.state.navigations.filter(({ url }) => url.startsWith('https://html.duckduckgo.com/')).length, 1);
  assert.equal(harness.state.closes, 1);
});

await test('the first API-gone search blocks private redirects through the shared request guard', async () => {
  const item = offer('https://example.com/jobs/old', { tracked: true, careersUrlDomain: 'example.com' });
  const target = 'http://169.254.169.254/latest/meta-data/';
  const harness = browserHarness({}, { searchRedirect: target });
  const result = await verifyOffers([item], { rediscover: true }, {
    checkApi: async () => gone,
    loadPlaywright: harness.loadPlaywright,
  });
  assert.deepEqual(harness.state.abortedRequests, [target]);
  assert.deepEqual(result.migrated, []);
  assert.deepEqual(urls(result.expired), [item.url]);
  assert.equal(harness.state.closes, 1);
});
