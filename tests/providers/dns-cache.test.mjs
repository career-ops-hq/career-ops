// tests/providers/dns-cache.test.mjs — cache semantics for providers/_dns-cache.mjs.
// Driven with a stub resolver: no network, no real DNS, deterministic clock.
import { pass, fail, run, NODE, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — DNS cache');

try {
  const { createCachedLookup } = await import(
    pathToFileURL(join(ROOT, 'providers/_dns-cache.mjs')).href
  );

  /**
   * Stub resolver that records calls and resolves on demand, so a test can
   * hold several lookups open at once and observe coalescing.
   */
  const mkResolver = (result = [null, '93.184.216.34', 4]) => {
    const calls = [];
    const resolver = (hostname, opts, cb) => {
      calls.push({ hostname, opts, cb });
    };
    resolver.calls = calls;
    resolver.flush = () => { for (const c of calls.splice(0)) c.cb(...result); };
    return resolver;
  };

  const lookupOnce = (fn, hostname, opts = {}) =>
    new Promise((resolve) => fn(hostname, opts, (...args) => resolve(args)));

  /**
   * Bound a wait so a dropped callback fails the assertion instead of hanging
   * the suite: an implementation that loses queued callbacks would otherwise
   * leave the process waiting forever with no output at all.
   */
  const within = (ms, promise) => {
    let timer;
    // The timer must NOT be unref'd: dropped callbacks leave nothing else
    // holding the event loop open, and an unref'd timer would let the process
    // exit silently instead of reporting the failure. Cleared on the winning
    // path so a passing run doesn't sit here for the full timeout.
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((resolve) => { timer = setTimeout(() => resolve('TIMED_OUT'), ms); }),
    ]);
  };

  // --- a repeat lookup is served from cache ---
  {
    const resolver = mkResolver();
    const lookup = createCachedLookup(resolver);

    const first = lookupOnce(lookup, 'example.com');
    resolver.flush();
    await first;

    const second = await lookupOnce(lookup, 'example.com');
    if (resolver.calls.length === 0 && second[1] === '93.184.216.34') {
      pass('repeat lookup is served from cache without a second resolver call');
    } else {
      fail(`repeat lookup hit the resolver ${resolver.calls.length} extra time(s)`);
    }
  }

  // --- concurrent misses coalesce into one resolver call ---
  {
    const resolver = mkResolver();
    const lookup = createCachedLookup(resolver);

    const pending = Array.from({ length: 20 }, () => lookupOnce(lookup, 'burst.example.com'));
    const callsDuringBurst = resolver.calls.length;
    resolver.flush();
    const settled = await within(2_000, Promise.all(pending));

    if (settled === 'TIMED_OUT') {
      fail('20 concurrent misses: not every queued callback fired (waiters dropped)');
    } else if (callsDuringBurst === 1 && settled.every((r) => r[1] === '93.184.216.34')) {
      pass('20 concurrent misses coalesce into 1 resolver call, all callbacks fire');
    } else {
      fail(`20 concurrent misses produced ${callsDuringBurst} resolver call(s)`);
    }
  }

  // --- failures are never cached ---
  {
    const err = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    const resolver = mkResolver([err]);
    const lookup = createCachedLookup(resolver);

    const first = lookupOnce(lookup, 'broken.example.com');
    resolver.flush();
    const [firstErr] = await first;

    const second = lookupOnce(lookup, 'broken.example.com');
    const retried = resolver.calls.length === 1;
    resolver.flush();
    await second;

    if (firstErr && firstErr.code === 'ENOTFOUND' && retried) {
      pass('a failed resolution is not cached — the next call retries the resolver');
    } else {
      fail(`failure caching wrong: err=${firstErr && firstErr.code} retried=${retried}`);
    }
  }

  // --- entries expire at the TTL boundary ---
  {
    const resolver = mkResolver();
    let clock = 1_000;
    const lookup = createCachedLookup(resolver, { ttlMs: 5_000, now: () => clock });

    const first = lookupOnce(lookup, 'ttl.example.com');
    resolver.flush();
    await first;

    clock += 4_999;                       // still inside the window
    const fresh = lookupOnce(lookup, 'ttl.example.com');
    const servedFromCache = resolver.calls.length === 0;
    await fresh;

    clock += 2;                           // now past expiry
    lookupOnce(lookup, 'ttl.example.com');
    const refetched = resolver.calls.length === 1;
    resolver.flush();

    if (servedFromCache && refetched) {
      pass('cache honors the TTL boundary — fresh inside it, re-resolves past it');
    } else {
      fail(`TTL wrong: servedFromCache=${servedFromCache} refetched=${refetched}`);
    }
  }

  // --- distinct option shapes do not collide ---
  {
    const resolver = mkResolver();
    const lookup = createCachedLookup(resolver);

    lookupOnce(lookup, 'opts.example.com', { family: 4 });
    lookupOnce(lookup, 'opts.example.com', { family: 6 });
    lookupOnce(lookup, 'opts.example.com', { all: true });

    if (resolver.calls.length === 3) {
      pass('family/all variants are cached under distinct keys');
    } else {
      fail(`option variants collapsed into ${resolver.calls.length} key(s), expected 3`);
    }
    resolver.flush();
  }

  // --- the module-level patch is opt-out-able ---
  {
    const probe = [
      'import dns from "node:dns";',
      'const before = dns.lookup;',
      'await import("./providers/_dns-cache.mjs");',
      'console.log(dns.lookup === before ? "UNPATCHED" : "PATCHED");',
    ].join('');

    const patched = run(NODE, ['--input-type=module', '-e', probe]);
    const optedOut = run(NODE, ['--input-type=module', '-e', probe], {
      env: { ...process.env, CAREER_OPS_NO_DNS_CACHE: '1' },
    });

    if (patched === 'PATCHED' && optedOut === 'UNPATCHED') {
      pass('importing the module patches dns.lookup; CAREER_OPS_NO_DNS_CACHE=1 opts out');
    } else {
      fail(`patch toggle wrong: default=${patched} optedOut=${optedOut}`);
    }
  }
} catch (e) {
  fail(`DNS cache tests threw: ${e.message}`);
}
