import assert from 'node:assert/strict';
import { pass, fail, results } from '../helpers.mjs';
import himalayas from '../../providers/himalayas.mjs';

async function check(name, run) {
  try {
    await run();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  }
}

const entry = { name: 'Fixture', provider: 'himalayas' };
const job = (id) => ({ title: `Engineer ${id}`, applicationLink: `https://himalayas.app/companies/fixture/jobs/${id}` });

await check('Himalayas follows opaque nextCursor and includes jobs beyond the first 20', async () => {
  const cursor = 'token+/=&?https://other.example/';
  const calls = [];
  const delays = [];
  const jobs = await himalayas.fetch(entry, {
    sleep: async (ms) => { delays.push(ms); },
    fetchJson: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return calls.length === 1
        ? { jobs: Array.from({ length: 20 }, (_, i) => job(i)), nextCursor: cursor, totalCount: 21 }
        : { jobs: [job(20)], totalCount: 21 };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(jobs.length, 21);
  assert.equal(jobs.at(-1).title, 'Engineer 20');
  assert.deepEqual(delays, [200]);
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://himalayas.app');
    assert.equal(url.pathname, '/jobs/api');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(options.redirect, 'error');
  }
  assert.equal(calls[1].url.searchParams.get('cursor'), cursor);
});

await check('Himalayas follows cursor after short or entirely filtered pages', async () => {
  let calls = 0;
  const jobs = await himalayas.fetch(entry, {
    sleep: async () => {},
    fetchJson: async () => ++calls === 1
      ? { jobs: [null, { title: 'Missing URL' }], nextCursor: 'second' }
      : { jobs: [job(2)] },
  });
  assert.equal(calls, 2);
  assert.equal(jobs[0].title, 'Engineer 2');
});

await check('Himalayas honors the health probe page cap without requesting more pages', async () => {
  let calls = 0;
  const jobs = await himalayas.fetch(entry, {
    maxPages: 1,
    fetchJson: async () => { calls++; return { jobs: [job(1)], nextCursor: 'second' }; },
  });
  assert.equal(calls, 1);
  assert.equal(jobs.length, 1);
});

await check('Himalayas health probe does not retry a status-less failure', async () => {
  // A plain Error has no status, so isRetryableError() treats it as retryable.
  // The probe must still make exactly one call and rethrow that same error
  // (providers/magneto.mjs's health-probe check).
  const probeErr = new Error('budget');
  let calls = 0;
  await assert.rejects(himalayas.fetch(entry, {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => { calls++; throw probeErr; },
  }), (err) => err === probeErr);
  assert.equal(calls, 1);
});

await check('Himalayas enforces the configured page budget and its absolute ceiling', async () => {
  const originalError = console.error;
  const warnings = [];
  console.error = (message) => { warnings.push(message); };
  try {
    for (const [max_pages, expectedCalls] of [[2, 2], [1000, 50]]) {
      let calls = 0;
      const jobs = await himalayas.fetch({ ...entry, max_pages }, {
        sleep: async () => {},
        fetchJson: async () => { calls++; return { jobs: [job(calls)], nextCursor: `page-${calls}` }; },
      });
      assert.equal(calls, expectedCalls);
      assert.equal(jobs.length, expectedCalls);
    }
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /truncated/);
  } finally {
    console.error = originalError;
  }
});

await check('Himalayas rejects repeated cursor cycles before repeating a page', async () => {
  let calls = 0;
  await assert.rejects(himalayas.fetch(entry, {
    sleep: async () => {},
    fetchJson: async () => { calls++; return { jobs: [job(calls)], nextCursor: 'same' }; },
  }), /repeated cursor/);
  assert.equal(calls, 2);
});

await check('Himalayas rejects a malformed continuation token', async () => {
  await assert.rejects(himalayas.fetch(entry, {
    fetchJson: async () => ({ jobs: [job(1)], nextCursor: { url: 'https://other.example/' } }),
  }), /nextCursor/);
});

await check('Himalayas still rejects malformed later pages', async () => {
  let calls = 0;
  await assert.rejects(himalayas.fetch(entry, {
    sleep: async () => {},
    fetchJson: async () => ++calls === 1 ? { jobs: [job(1)], nextCursor: 'second' } : { error: 'broken' },
  }), /unexpected API response/);
});

for (const status of [429, 503, undefined]) {
  await check(`Himalayas retries a transient later-page failure (${status ?? 'transport'})`, async () => {
    const calls = [];
    const delays = [];
    const error = Object.assign(new Error('temporary failure'), { status });
    const jobs = await himalayas.fetch(entry, {
      sleep: async (ms) => { delays.push(ms); },
      fetchJson: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) return { jobs: [job(1)], nextCursor: 'second' };
        if (calls.length === 2) throw error;
        return { jobs: [job(2)] };
      },
    });
    assert.deepEqual(jobs.map(({ title }) => title), ['Engineer 1', 'Engineer 2']);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2], calls[1]);
    assert.equal(new URL(calls[2].url).searchParams.get('cursor'), 'second');
    assert.equal(delays[0], 200);
    assert.equal(delays.length, 2);
    assert.ok(delays[1] >= 500 && delays[1] <= 8000);
  });
}

for (const [status, attempts] of [[404, 1], [503, 3]]) {
  await check(`Himalayas surfaces a later-page HTTP ${status} after ${attempts} attempt(s)`, async () => {
    let calls = 0;
    const error = Object.assign(new Error('page unavailable'), { status });
    await assert.rejects(himalayas.fetch(entry, {
      sleep: async () => {},
      fetchJson: async () => {
        if (++calls === 1) return { jobs: [job(1)], nextCursor: 'second' };
        throw error;
      },
    }), (actual) => actual === error && actual.status === status && actual.attempts === attempts);
    assert.equal(calls, 1 + attempts);
  });
}

if (results().failed) process.exitCode = 1;
