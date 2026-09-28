// tests/providers/dns-pacing.test.mjs — token-bucket pacing for providers/_dns-cache.mjs.
// Fake clock + manual timer: no real waiting, no network, deterministic ordering.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — DNS lookup pacing');

try {
  const { createTokenBucket, createCachedLookup, lookupsPerMinFromEnv } = await import(
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

  // --- a refill delay never exceeds Node's maximum timeout ---
  // setTimeout clamps anything above 2^31-1 ms to 1ms, so an unbounded delay
  // does not wait — it fires pump() immediately, gains no token, and re-arms,
  // spinning at 1ms forever. A rate low enough to overflow must still schedule
  // a real wait.
  {
    const MAX_TIMER_MS = 2_147_483_647;
    let clock = 0;
    const delays = [];
    const setTimer = (fn, ms) => { delays.push(ms); };
    const bucket = createTokenBucket({
      ratePerMin: 1e-5, capacity: 1, now: () => clock, setTimer,
    });

    bucket.take(() => {});   // spends the only token, runs inline, schedules nothing
    bucket.take(() => {});   // queues, so this one arms the refill timer

    const armed = delays.length === 1 && delays[0] <= MAX_TIMER_MS && delays[0] >= 1;
    if (armed) {
      pass('a tiny rate still schedules within the maximum timeout instead of clamping to 1ms');
    } else {
      fail(`refill delay out of range: ${JSON.stringify(delays)} (max ${MAX_TIMER_MS})`);
    }
  }

  // --- a throwing callback does not strand the queue ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const bucket = createTokenBucket({ ratePerMin: 60, capacity: 1, now: () => clock, setTimer });

    // Drain the bucket so the next calls queue.
    bucket.take(() => {});
    const ran = [];
    const thrower = () => { throw new Error('test error'); };
    bucket.take(thrower);         // First queued: will throw
    bucket.take(() => ran.push(1)); // Second queued
    bucket.take(() => ran.push(2)); // Third queued

    // Advance clock and fire timers. The first callback throws, but schedule()
    // must still be called (via finally block) to arm the next timer. We wrap
    // fireAll in try/catch so the error is contained and doesn't break the test.
    clock += 1_000;
    try { setTimer.fireAll(); } catch (e) { /* Expected: thrower throws. */ }

    // The thrower spent that token, so nothing else ran in the first pump.
    // Each later refill releases exactly one queued callback.
    clock += 1_000;
    try { setTimer.fireAll(); } catch (e) { /* Expected: should not throw again. */ }

    // Third callback runs in this pump.
    clock += 1_000;
    try { setTimer.fireAll(); } catch (e) { /* should not happen */ }

    if (ran.join(',') === '1,2') {
      pass('a throwing callback does not strand the queue');
    } else {
      fail(`queue stranded: ran=[${ran.join(',')}]`);
    }
  }

  const mkResolver = (result = [null, '93.184.216.34', 4]) => {
    const calls = [];
    const resolver = (hostname, opts, cb) => { calls.push({ hostname, opts, cb }); };
    resolver.calls = calls;
    resolver.flush = () => { for (const c of calls.splice(0)) c.cb(...result); };
    return resolver;
  };

  const lookupOnce = (fn, hostname, opts = {}) =>
    new Promise((resolve) => fn(hostname, opts, (...args) => resolve(args)));

  // --- distinct hostnames are metered ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const resolver = mkResolver();
    const lookup = createCachedLookup(resolver, {
      lookupsPerMin: 60, burst: 2, now: () => clock, setTimer,
    });

    for (let i = 0; i < 5; i++) lookupOnce(lookup, `h${i}.example.com`);
    const duringBurst = resolver.calls.length;

    clock += 1_000;
    setTimer.fireAll();
    const afterRefill = resolver.calls.length;
    resolver.flush();

    if (duringBurst === 2 && afterRefill === 3) {
      pass('5 distinct hostnames: 2 resolved on the burst, 1 more per refill');
    } else {
      fail(`hostname pacing wrong: duringBurst=${duringBurst} afterRefill=${afterRefill}`);
    }
  }

  // --- coalesced waiters and cache hits are free ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const resolver = mkResolver();
    const lookup = createCachedLookup(resolver, {
      lookupsPerMin: 60, burst: 1, now: () => clock, setTimer,
    });

    // 20 concurrent callers, one hostname: only the leader reaches the
    // resolver, so only the leader may spend the single available token.
    const pending = Array.from({ length: 20 }, () => lookupOnce(lookup, 'one.example.com'));
    const leaderOnly = resolver.calls.length === 1 && setTimer.pending() === 0;
    resolver.flush();
    await Promise.all(pending);

    // And a warm cache hit must not queue behind the (now empty) bucket.
    await lookupOnce(lookup, 'one.example.com');
    const hitWasFree = resolver.calls.length === 0 && setTimer.pending() === 0;

    if (leaderOnly && hitWasFree) {
      pass('coalesced waiters and cache hits take no tokens — pacing tracks distinct hostnames');
    } else {
      fail(`token accounting wrong: leaderOnly=${leaderOnly} hitWasFree=${hitWasFree}`);
    }
  }

  // --- a negative-cached refusal is free too ---
  // Guards the seam between negative caching (#2229 resolver refusals) and
  // pacing: both landed separately, so nothing covered them together. A
  // refusal held in the negative cache is answered from memory and never
  // reaches the resolver, so it must not wait on a token either — otherwise a
  // drained bucket would stall the very retry storm the negative cache exists
  // to absorb.
  {
    let clock = 0;
    const setTimer = mkTimer();
    const refusal = Object.assign(new Error('refused'), { code: 'EREFUSED' });
    const resolver = mkResolver([refusal]);
    const lookup = createCachedLookup(resolver, {
      lookupsPerMin: 60, burst: 1, now: () => clock, setTimer,
    });

    // The leader spends the only token and is refused; the refusal is cached.
    const first = lookupOnce(lookup, 'refused.example.com');
    resolver.flush();
    const [firstErr] = await first;

    // Bucket is now empty. Deliver via callback rather than await: if the hit
    // wrongly queued for a token it would never settle, and this must fail
    // rather than hang.
    let settled = false;
    let secondErr = null;
    lookup('refused.example.com', {}, (e) => { settled = true; secondErr = e; });
    await new Promise((r) => setImmediate(r));

    const free = settled && resolver.calls.length === 0 && setTimer.pending() === 0;
    if (free && firstErr?.code === 'EREFUSED' && secondErr?.code === 'EREFUSED') {
      pass('a negative-cached refusal is served without spending a pacing token');
    } else {
      fail(`negative-cache hit not free: settled=${settled} calls=${resolver.calls.length} `
        + `pending=${setTimer.pending()} first=${firstErr?.code} second=${secondErr?.code}`);
    }
  }

  // --- pacing can be switched off entirely ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const resolver = mkResolver();
    const lookup = createCachedLookup(resolver, {
      lookupsPerMin: 0, now: () => clock, setTimer,
    });

    for (let i = 0; i < 50; i++) lookupOnce(lookup, `off${i}.example.com`);
    const all = resolver.calls.length === 50 && setTimer.pending() === 0;
    resolver.flush();

    if (all) {
      pass('lookupsPerMin: 0 disables pacing — every miss goes straight to the resolver');
    } else {
      fail(`disable wrong: calls=${resolver.calls.length} timers=${setTimer.pending()}`);
    }
  }

  // --- env parsing: unset means the default, junk means the default, 0 means off ---
  {
    const seen = {
      unset: lookupsPerMinFromEnv({}),
      empty: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: '' }),
      set: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: '120' }),
      off: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0' }),
      junk: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: 'fast' }),
      negative: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: '-1' }),
    };

    if (seen.unset === 400 && seen.empty === 400 && seen.set === 120
        && seen.off === 0 && seen.junk === 400 && seen.negative === 400) {
      pass('CAREER_OPS_DNS_LOOKUPS_PER_MIN parses, defaults to 400, and 0 disables');
    } else {
      fail(`env parsing wrong: ${JSON.stringify(seen)}`);
    }
  }

  // --- whitespace must not read as 0 ---
  // `Number(' ')` is 0, and 0 is the documented "pacing off" value, so a
  // whitespace-only setting would silently disable the rate limiter instead of
  // being rejected like any other junk. Silent-off is the one failure this knob
  // must never have.
  {
    const seen = {
      space: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: ' ' }),
      tab: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: '\t' }),
      padded: lookupsPerMinFromEnv({ CAREER_OPS_DNS_LOOKUPS_PER_MIN: ' 120 ' }),
    };

    if (seen.space === 400 && seen.tab === 400 && seen.padded === 120) {
      pass('whitespace falls back to the default instead of silently disabling pacing');
    } else {
      fail(`whitespace handling wrong: ${JSON.stringify(seen)}`);
    }
  }

  // --- pacing is on by default, with no options passed ---
  {
    let clock = 0;
    const setTimer = mkTimer();
    const resolver = mkResolver();
    // Only the clock and timer are injected: rate and burst take their defaults.
    const lookup = createCachedLookup(resolver, { now: () => clock, setTimer });

    for (let i = 0; i < 25; i++) lookupOnce(lookup, `d${i}.example.com`);
    const admitted = resolver.calls.length;
    const queued = setTimer.pending() > 0;
    resolver.flush();

    if (admitted === 20 && queued) {
      pass('pacing defaults to on — 25 hostnames admit the 20-token burst and queue the rest');
    } else {
      fail(`default pacing wrong: admitted=${admitted} queued=${queued}`);
    }
  }
} catch (e) {
  fail(`DNS pacing tests threw: ${e.message}`);
}
