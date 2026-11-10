// tests/liveness-host-spacer.test.mjs — --throttle spaces browser visits per host.
//
// A WAF rate limit is per site. A global gap made a 641-URL run across ~40 hosts
// wait 5-10 s before every browser check (~1.5 h). Per host, only a repeat visit
// to the same site waits, and time already spent elsewhere counts toward the gap.
//
// Run:  node --test tests/liveness-host-spacer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostSpacer } from '../liveness-browser.mjs';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
const fixedDelay = (base) => base; // jitter removed so assertions are exact

test('first visit to a host never waits', () => {
  const c = clock();
  const s = createHostSpacer(5000, { now: c.now, delay: fixedDelay });
  assert.equal(s.waitBefore('https://pracuj.pl/a'), 0);
  s.visited('https://pracuj.pl/a');
  assert.equal(s.waitBefore('https://builtin.com/job/1'), 0, 'a different host is not delayed');
});

test('a repeat visit waits the remainder of the gap', () => {
  const c = clock();
  const s = createHostSpacer(5000, { now: c.now, delay: fixedDelay });
  s.visited('https://pracuj.pl/a');
  assert.equal(s.waitBefore('https://pracuj.pl/b'), 5000);
  c.advance(3000);
  assert.equal(s.waitBefore('https://www.pracuj.pl/c'), 2000, 'www. is the same site; elapsed time counts');
  c.advance(4000);
  assert.equal(s.waitBefore('https://pracuj.pl/d'), 0);
});

test('throttling off (base 0) never waits', () => {
  const s = createHostSpacer(0);
  s.visited('https://pracuj.pl/a');
  assert.equal(s.waitBefore('https://pracuj.pl/b'), 0);
});

test('default delay stays within the documented jitter band', () => {
  const c = clock();
  const s = createHostSpacer(5000, { now: c.now });
  s.visited('https://pracuj.pl/a');
  for (let i = 0; i < 50; i++) {
    const w = s.waitBefore('https://pracuj.pl/b');
    assert.ok(w >= 5000 && w < 10000, String(w));
  }
});
