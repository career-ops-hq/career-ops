// tests/providers/dns-pacing.test.mjs — token-bucket pacing for providers/_dns-cache.mjs.
// Fake clock + manual timer: no real waiting, no network, deterministic ordering.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — DNS lookup pacing');

try {
  const { createTokenBucket } = await import(
    pathToFileURL(join(ROOT, 'providers/_dns-cache.mjs')).href
  );

  /**
   * Manual timer: records what the bucket scheduled instead of waiting for it.
   * `fireAll()` runs everything currently pending — anything the callback
   * schedules in turn lands in the next batch, so a test advances the clock
   * one refill at a time and sees exactly one release per step.
   */
  const mkTimer = () => {
    const timers = [];
    const setTimer = (fn, ms) => { timers.push({ fn, ms }); };
    setTimer.fireAll = () => { for (const t of timers.splice(0)) t.fn(); };
    setTimer.pending = () => timers.length;
    return setTimer;
  };

  // --- a burst up to capacity runs immediately, the rest queues ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const bucket = createTokenBucket({ ratePerMin: 60, capacity: 3, now: () => clock, setTimer });

    const ran = [];
    for (let i = 0; i < 5; i++) bucket.take(() => ran.push(i));
    const immediate = ran.join(',');

    clock += 1_000;                       // 60/min = one token per second
    setTimer.fireAll();
    const afterOne = ran.join(',');

    clock += 1_000;
    setTimer.fireAll();
    const afterTwo = ran.join(',');

    if (immediate === '0,1,2' && afterOne === '0,1,2,3' && afterTwo === '0,1,2,3,4') {
      pass('token bucket admits the burst, then releases one per refill in FIFO order');
    } else {
      fail(`pacing wrong: immediate=[${immediate}] afterOne=[${afterOne}] afterTwo=[${afterTwo}]`);
    }
  }

  // --- an idle bucket refills back to capacity, and no further ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const bucket = createTokenBucket({ ratePerMin: 60, capacity: 3, now: () => clock, setTimer });

    for (let i = 0; i < 3; i++) bucket.take(() => {});   // drain
    clock += 60_000;                                      // idle a full minute
    const ran = [];
    for (let i = 0; i < 5; i++) bucket.take(() => ran.push(i));

    if (ran.join(',') === '0,1,2' && bucket.pending === 2) {
      pass('an idle bucket refills to capacity and is capped there');
    } else {
      fail(`refill cap wrong: ran=[${ran.join(',')}] pending=${bucket.pending}`);
    }
  }

  // --- stats count only the delayed calls, and how long they waited ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const bucket = createTokenBucket({ ratePerMin: 60, capacity: 1, now: () => clock, setTimer });

    bucket.take(() => {});                // immediate — not delayed
    bucket.take(() => {});                // queued
    clock += 1_000;
    setTimer.fireAll();

    const s = bucket.stats();
    if (s.delayed === 1 && s.waitedMs === 1_000) {
      pass('stats report 1 delayed lookup waiting 1000ms');
    } else {
      fail(`stats wrong: delayed=${s.delayed} waitedMs=${s.waitedMs}`);
    }
  }

  // --- a nonsense rate is a caller error, not a silent Infinity ---
  {
    const bad = [];
    for (const rate of [0, -5, Number.NaN]) {
      try { createTokenBucket({ ratePerMin: rate }); bad.push(rate); } catch (e) {
        if (!(e instanceof RangeError)) bad.push(`${rate}:${e.constructor.name}`);
      }
    }
    if (bad.length === 0) {
      pass('createTokenBucket rejects a non-positive or non-finite rate with RangeError');
    } else {
      fail(`bad rates accepted or wrongly typed: ${bad.join(', ')}`);
    }
  }
} catch (e) {
  fail(`DNS pacing tests threw: ${e.message}`);
}
