import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { setHostResolver, validateUrlSecurity } from '../liveness-browser.mjs';

const URL = 'https://careers.example.com/jobs/123';
const originalNow = Date.now;
let now = 1_000;
Date.now = () => now;

async function check(label, run) {
  try {
    await run();
    pass(label);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

try {
  for (const missingAddresses of [false, true]) {
    await check(`DNS ${missingAddresses ? 'empty answer' : 'resolver error'} is cached briefly, then recovers`, async () => {
      let calls = 0;
      const error = new Error('temporary DNS outage');
      error.code = 'EAI_AGAIN';
      const restore = setHostResolver(async () => {
        if (++calls > 1) return ['93.184.216.34'];
        if (missingAddresses) return [];
        throw error;
      });
      try {
        const expected = missingAddresses ? { livenessCode: 'dns_no_addresses' } : error;
        await assert.rejects(validateUrlSecurity(URL), expected);
        now += 29_999;
        await assert.rejects(validateUrlSecurity(URL), expected);
        assert.equal(calls, 1, 'fresh negative cache avoids another lookup');
        now += 1;
        await validateUrlSecurity(URL);
        assert.equal(calls, 2, 'failure expires after 30 seconds');
        now += 60_000;
        await validateUrlSecurity(URL);
        assert.equal(calls, 2, 'successful answers retain existing memoization');
      } finally {
        restore();
      }
    });
  }

  for (const addresses of [['127.0.0.1'], ['93.184.216.34', '10.0.0.1']]) {
    await check(`DNS recovery still blocks private answers ${addresses.join(', ')}`, async () => {
      let calls = 0;
      const restore = setHostResolver(async () => {
        if (++calls === 1) throw new Error('temporary DNS outage');
        return addresses;
      });
      try {
        await assert.rejects(validateUrlSecurity(URL), /temporary DNS outage/);
        now += 30_000;
        await assert.rejects(validateUrlSecurity(URL), /Egress guard blocked private target IP/);
        assert.equal(calls, 2);
        await assert.rejects(validateUrlSecurity(URL), /Egress guard blocked private target IP/);
        assert.equal(calls, 2);
      } finally {
        restore();
      }
    });
  }

  await check('resolver replacement and restoration clear negative cache', async () => {
    const restoreFailure = setHostResolver(async () => { throw new Error('first resolver'); });
    try {
      await assert.rejects(validateUrlSecurity(URL), /first resolver/);
      const restoreSuccess = setHostResolver(async () => ['93.184.216.34']);
      try {
        await validateUrlSecurity(URL);
      } finally {
        restoreSuccess();
      }
      await assert.rejects(validateUrlSecurity(URL), /first resolver/);
    } finally {
      restoreFailure();
    }
  });
} finally {
  Date.now = originalNow;
}
