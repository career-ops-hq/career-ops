// tests/scan-verify-dns.test.mjs — scan --verify keeps a posting whose own host
// has no usable address, and still pins one that resolves into private space.
//
// The route guard used to report both as blocked_host, which --verify records as
// skipped_blocked_host, a permanent status. No DNS answer, or only a DNS filter's
// 0.0.0.0 and ::, can be an outage during the run or the user's own filter, so a
// live posting checked at the wrong moment was dropped for good.
//
// The browser double sends the posting's own navigation through the real route
// guard, shaped like a Playwright main-document request. The resolver is
// injected, so nothing leaves the machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyOffers } from '../scan.mjs';
import { setHostResolver } from '../liveness-browser.mjs';

const ANSWERS = {
  'outage.example': [],
  'filtered.example': ['0.0.0.0', '::'],
  'internal.example': ['10.0.0.1'],
  'loopback-too.example': ['0.0.0.0', '127.0.0.1'],
  'live.example': ['93.184.216.34'],
};
const offers = Object.keys(ANSWERS).map((host) => ({ company: host, title: 'Platform Engineer', url: `https://${host}/jobs/1` }));
const byHost = (host) => offers.find((offer) => offer.company === host);
const hosts = (list) => list.map((offer) => offer.company);
const body = 'Build reliable services with our platform engineering team. '.repeat(12);

const chromium = {
  async launch() {
    const main = {};
    let guard = null;
    let current = 'about:blank';
    const page = {
      mainFrame: () => main,
      async route(_pattern, handler) { guard = handler; },
      async goto(url) {
        current = url;
        let aborted = false;
        await guard({
          request: () => ({ url: () => url, isNavigationRequest: () => true, frame: () => main }),
          async abort() { aborted = true; },
          async continue() {},
        });
        if (aborted) throw new Error('net::ERR_BLOCKED_BY_CLIENT');
        return { status: () => 200 };
      },
      async waitForTimeout() {},
      url: () => current,
      async evaluate(fn) {
        return String(fn).includes('querySelectorAll') ? ['Apply now'] : body;
      },
    };
    return {
      async newContext() { return { async newPage() { return page; } }; },
      async close() {},
    };
  },
};

await test('a posting whose own host has no usable address is kept; a private answer is still pinned', async () => {
  const restore = setHostResolver(async (hostname) => ANSWERS[hostname] ?? []);
  try {
    const result = await verifyOffers(offers, {}, {
      checkApi: async () => null,
      loadPlaywright: async () => ({ chromium }),
    });

    assert.deepEqual(hosts(result.verified), ['outage.example', 'filtered.example', 'live.example']);
    assert.equal(result.verificationStatusByOffer.get(byHost('outage.example')), 'uncertain');
    assert.equal(result.verificationStatusByOffer.get(byHost('filtered.example')), 'uncertain');
    assert.equal(result.verificationStatusByOffer.get(byHost('live.example')), 'active');

    assert.deepEqual(hosts(result.invalid), ['internal.example', 'loopback-too.example']);
    assert.deepEqual(result.invalid.map(({ code }) => code), ['blocked_host', 'blocked_host']);
    assert.deepEqual(result.expired, []);
    assert.deepEqual(result.dropped, []);
  } finally {
    // A leaked stub would answer for every later test in this process.
    restore();
  }
});
