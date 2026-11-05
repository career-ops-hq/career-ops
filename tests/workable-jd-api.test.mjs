// Offline full-body Workable JD coverage (#5425). No browser or real listing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeWorkableJob, fetchJdViaKnownApi, JD_FETCHERS } from '../browser-extract.mjs';
import { JD_TEXT_API_ATS } from '../liveness-api.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const FULL = 'https://apply.workable.com/fictional-employer/j/FIXTURE123/';
const SHORT = 'https://apply.workable.com/j/FIXTURE123';
const API = 'https://apply.workable.com/api/v2/accounts/fictional-employer/jobs/FIXTURE123';
const posting = {
  shortcode: 'FIXTURE123', title: 'Fixture &amp; Engineer', state: 'published',
  description: '<nav>navigation marker</nav><p>DESCRIPTION_MARKER build systems.</p><script>script marker</script>',
  requirements: '<ul><li>REQUIREMENTS_MARKER programming experience.</li></ul>',
  benefits: '<p>BENEFITS_MARKER flexible hours.</p>',
};
async function mocked(fetcher, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await run(); } finally { globalThis.fetch = previous; }
}
const response = (value = posting) => new Response(JSON.stringify(value));

test('normalizer preserves title, ordered labeled sections, cap and excludes chrome/scripts', () => {
  const result = normalizeWorkableJob(posting, 'FIXTURE123', FULL);
  assert.equal(result.title, 'Fixture & Engineer');
  assert.equal(result.url, FULL);
  assert.match(result.text, /Description:.*DESCRIPTION_MARKER.*Requirements:.*REQUIREMENTS_MARKER.*Benefits:.*BENEFITS_MARKER/s);
  assert.doesNotMatch(result.text, /navigation marker|script marker/);
  const long = { ...posting, description: '<p>' + 'x'.repeat(4500) + '</p>' };
  assert.match(normalizeWorkableJob(long, 'FIXTURE123', FULL, 20000).text, /REQUIREMENTS_MARKER/);
  const capped = normalizeWorkableJob(long, 'FIXTURE123', FULL, 100).text;
  assert.equal(capped.length, 101); // existing compactText cap + ellipsis convention
  assert.ok(capped.endsWith('…'));
  const optional = normalizeWorkableJob({ ...posting, requirements: null, benefits: '' }, 'FIXTURE123', FULL);
  assert.doesNotMatch(optional.text, /Requirements:|Benefits:/);
});

test('reject missing/wrong identity, malformed shapes and metadata-only payloads', () => {
  for (const value of [null, [], {}, { ...posting, shortcode: undefined }, { ...posting, shortcode: 'OTHER' },
    { ...posting, title: '' }, { ...posting, title: '<script>hidden</script>' }, { ...posting, description: '<p> </p>', requirements: null, benefits: '<script>hidden</script>' }]) {
    assert.equal(normalizeWorkableJob(value, 'FIXTURE123', FULL), null);
  }
  // JD retrieval is not a liveness verdict: readable closed content remains text only.
  assert.ok(normalizeWorkableJob({ ...posting, state: 'closed' }, 'FIXTURE123', FULL));
});

test('shared routing parity and canonical success use only resolver-derived API', async () => {
  assert.deepEqual(Object.keys(JD_FETCHERS).sort(), [...JD_TEXT_API_ATS].sort());
  const calls = [];
  const result = await mocked(async (url, opts) => {
    calls.push([url, opts.redirect]);
    return response();
  }, () => fetchJdViaKnownApi(FULL));
  assert.equal(result.ats, 'workable');
  assert.match(result.text, /REQUIREMENTS_MARKER/);
  assert.deepEqual(calls, [[API, 'error']]);
});

test('short link reuses guarded redirect resolution then extracts all sections', async () => {
  const calls = [];
  const result = await mocked(async (url, opts) => {
    calls.push([url, opts.redirect]);
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/fictional-employer/j/FIXTURE123' } }) : response();
  }, () => fetchJdViaKnownApi(SHORT));
  assert.equal(result.ats, 'workable-short');
  assert.equal(result.url, SHORT);
  assert.match(result.text, /BENEFITS_MARKER/);
  assert.deepEqual(calls, [[SHORT, 'manual'], [API, 'error']]);
});

for (const location of ['https://evil.example/fictional-employer/j/FIXTURE123',
  'http://apply.workable.com/fictional-employer/j/FIXTURE123', '/fictional-employer/j/OTHER',
  'https://127.0.0.1/fictional-employer/j/FIXTURE123']) {
  test(`short redirect rejected without fetching target: ${location}`, async () => {
    let count = 0;
    const result = await mocked(async () => {
      count++;
      return new Response(null, { status: 302, headers: { location } });
    }, () => fetchJdViaKnownApi(SHORT));
    assert.equal(result, null);
    assert.equal(count, 1);
  });
}

test('HTTP, JSON, body and timeout failures remain misses', async () => {
  for (const mock of [
    async () => new Response('', { status: 404 }),
    async () => new Response('', { status: 503 }),
    async () => new Response('invalid json'),
    async () => response({ ...posting, shortcode: 'OTHER' }),
    async () => response({ ...posting, description: '', requirements: '', benefits: '' }),
    async () => { throw new Error('redirect rejected'); },
    async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })),
  ]) {
    assert.equal(await mocked(mock, () => fetchJdViaKnownApi(FULL, 20000, 10)), null);
  }
});

test('unsupported and unsafe input never fetches', async () => {
  await mocked(async () => { assert.fail('unexpected network'); }, async () => {
    for (const url of ['https://example.test/j/FIXTURE123', 'http://apply.workable.com/fictional-employer/j/FIXTURE123', 'https://127.0.0.1/j/FIXTURE123']) {
      assert.equal(await fetchJdViaKnownApi(url), null);
    }
  });
});

test('real CLIs use shared API dispatch: success and silent fetch-jd miss', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workable-jd-test-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const preload = join(dir, 'fetch-fixture.mjs');
    writeFileSync(preload, `globalThis.fetch = async (url, options) => {
      if (process.env.FIXTURE_MISS) return new Response('', {status:404});
      if (String(url) === ${JSON.stringify(SHORT)}) return new Response(null,{status:302,headers:{location:'/fictional-employer/j/FIXTURE123'}});
      if (String(url) !== ${JSON.stringify(API)}) throw new Error('unexpected request');
      return new Response(${JSON.stringify(JSON.stringify({ ...posting, description: '<p>' + 'x'.repeat(4500) + '</p>' }))});
    };`);
    const run = (script, args, miss = false) => spawnSync(process.execPath,
      ['--import', pathToFileURL(preload).href, join(root, script), ...args],
      { cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, FIXTURE_MISS: miss ? '1' : '' } });
    for (const url of [FULL, SHORT]) {
      const result = run('fetch-jd.mjs', [url]);
      assert.equal(result.status, 0, describeSpawn(result));
      assert.match(result.stdout, /Fixture & Engineer/);
      assert.match(result.stdout, /REQUIREMENTS_MARKER/);
      assert.match(result.stdout, /BENEFITS_MARKER/);
      const miss = run('fetch-jd.mjs', [url], true);
      assert.equal(miss.status, 1, describeSpawn(miss));
      assert.equal(miss.stdout, '');
      assert.equal(miss.stderr, '');
      const interactive = run('browser-extract.mjs', [url, '--mode', 'jd']);
      assert.equal(interactive.status, 0, describeSpawn(interactive));
      assert.match(JSON.parse(interactive.stdout).text, /REQUIREMENTS_MARKER/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('short-link missing redirects and API errors remain misses', async () => {
  for (const initial of [new Response('shell'), new Response(null, {status: 302}),
    new Response(null, {status: 307, headers: {location: '/fictional-employer/j/FIXTURE123'}})]) {
    let calls = 0;
    assert.equal(await mocked(async () => {calls++; return initial;}, () => fetchJdViaKnownApi(SHORT)), null);
    assert.equal(calls, 1);
  }
  for (const status of [301, 302]) {
    let calls = 0;
    assert.equal(await mocked(async () => ++calls === 1
      ? new Response(null, {status, headers: {location: '/fictional-employer/j/FIXTURE123'}})
      : new Response('', {status: 404}), () => fetchJdViaKnownApi(SHORT)), null);
    assert.equal(calls, 2);
  }
});

test('entity-encoded navigation is removed before JD text normalization', () => {
  const encoded = {
    ...posting,
    description: '&lt;nav&gt;ENCODED_NAV&lt;/nav&gt;&lt;p&gt;DESCRIPTION_MARKER &amp; useful work&lt;/p&gt;',
    requirements: '&lt;header&gt;ENCODED_HEADER&lt;/header&gt;&lt;ul&gt;&lt;li&gt;REQUIREMENTS_MARKER&lt;/li&gt;&lt;/ul&gt;',
    benefits: '&lt;footer&gt;ENCODED_FOOTER&lt;/footer&gt;&lt;p&gt;BENEFITS_MARKER&lt;/p&gt;',
  };
  const result = normalizeWorkableJob(encoded, 'FIXTURE123', FULL);
  assert.match(result.text, /DESCRIPTION_MARKER & useful work/);
  assert.match(result.text, /Requirements:.*REQUIREMENTS_MARKER.*Benefits:.*BENEFITS_MARKER/s);
  assert.doesNotMatch(result.text, /ENCODED_NAV|ENCODED_HEADER|ENCODED_FOOTER/);
});

test('encoded navigation alone is not a meaningful JD', () => {
  const chrome = {
    ...posting,
    description: '&lt;nav&gt;Jobs and teams&lt;/nav&gt;',
    requirements: '&lt;header&gt;Company careers&lt;/header&gt;',
    benefits: '&lt;footer&gt;Contact us&lt;/footer&gt;',
  };
  assert.equal(normalizeWorkableJob(chrome, 'FIXTURE123', FULL), null);
});

test('short-link first-hop timeout is a miss and never reaches the posting API', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  await mocked(async (url, { signal }) => {
    calls.push(url);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, async () => {
    const pending = fetchJdViaKnownApi(SHORT, 20000, 100);
    t.mock.timers.tick(100);
    assert.equal(await pending, null);
  });
  assert.deepEqual(calls, [SHORT]);
});

for (const phase of ['fetch', 'body']) {
  test(`short-link second-hop ${phase} shares the remaining total timeout budget`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    let firstSignal;
    let secondSignal;
    let enteredSecond;
    const secondReady = new Promise(resolve => { enteredSecond = resolve; });
    await mocked(async (url, { signal }) => {
      calls.push(url);
      if (url === SHORT) {
        firstSignal = signal;
        t.mock.timers.tick(60); // Account resolution consumes part of the one budget.
        return new Response(null, { status: 302, headers: { location: '/fictional-employer/j/FIXTURE123' } });
      }
      assert.equal(url, API);
      secondSignal = signal;
      const stall = () => {
        enteredSecond();
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      };
      return phase === 'fetch' ? stall() : { ok: true, json: stall };
    }, async () => {
      const pending = fetchJdViaKnownApi(SHORT, 20000, 100);
      await secondReady;
      assert.equal(secondSignal, firstSignal);
      t.mock.timers.tick(39);
      assert.equal(secondSignal.aborted, false);
      t.mock.timers.tick(1); // Only 40ms remain, not a fresh 100ms per hop.
      assert.equal(secondSignal.aborted, true);
      assert.equal(await pending, null);
    });
    assert.deepEqual(calls, [SHORT, API]);
  });
}
