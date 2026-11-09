// Direct, provider-independent coverage for providers/_cached-lookup.mjs.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — _cached-lookup (a looked-up value kept in ctx.idCache)');

try {
  const { cachedLookup, DEFAULT_RECHECK_MS } = await import(pathToFileURL(join(ROOT, 'providers/_cached-lookup.mjs')).href);

  const memCache = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { values, get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const fresh = ago(60 * 1000);
  const stale = ago(DEFAULT_RECHECK_MS + 60 * 1000);
  const isValid = (v) => Number.isInteger(v) && v > 0;
  const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  // A lookup that counts its calls and answers with `result` (a value, or an
  // Error to throw).
  const lookupOf = (result) => {
    const fn = async () => {
      fn.calls++;
      if (result instanceof Error) throw result;
      return result;
    };
    fn.calls = 0;
    return fn;
  };
  const rejects = async (promise) => {
    try {
      await promise;
      return null;
    } catch (err) {
      return err;
    }
  };

  if (DEFAULT_RECHECK_MS === 30 * 24 * 60 * 60 * 1000) pass('DEFAULT_RECHECK_MS is 30 days');
  else fail(`DEFAULT_RECHECK_MS is ${DEFAULT_RECHECK_MS}`);

  {
    const cache = memCache({ k: { id: 7, checkedAt: fresh } });
    const lookup = lookupOf(8);
    const value = await cachedLookup(cache, 'k', lookup, { isValid });
    if (value === 7 && lookup.calls === 0 && cache.values.get('k').checkedAt === fresh) pass('a fresh cached value is returned without a lookup');
    else fail(`fresh hit wrong: value=${value}, calls=${lookup.calls}, entry=${JSON.stringify(cache.values.get('k'))}`);
  }

  {
    const cache = memCache();
    const lookup = lookupOf(8);
    const value = await cachedLookup(cache, 'k', lookup, { isValid });
    const entry = cache.values.get('k');
    if (value === 8 && lookup.calls === 1 && entry?.id === 8 && Number.isFinite(Date.parse(entry.checkedAt))) {
      pass('a miss looks the value up and stores it as { id, checkedAt }');
    } else {
      fail(`miss wrong: value=${value}, calls=${lookup.calls}, entry=${JSON.stringify(entry)}`);
    }
  }

  {
    const cache = memCache({ k: { id: 7, checkedAt: stale } });
    const lookup = lookupOf(8);
    const value = await cachedLookup(cache, 'k', lookup, { isValid });
    const entry = cache.values.get('k');
    if (value === 8 && lookup.calls === 1 && entry.id === 8 && entry.checkedAt !== stale) pass('a value older than the recheck age is looked up again and replaced');
    else fail(`stale recheck wrong: value=${value}, calls=${lookup.calls}, entry=${JSON.stringify(entry)}`);
  }

  {
    const cache = memCache({ k: { id: 7, checkedAt: stale } });
    const lookup = lookupOf(httpError(503));
    const value = await cachedLookup(cache, 'k', lookup, { isValid });
    if (value === 7 && lookup.calls === 1 && cache.values.get('k').checkedAt === stale) {
      pass('a failed recheck keeps the cached value and leaves checkedAt alone, so the next call checks again');
    } else {
      fail(`failed recheck wrong: value=${value}, entry=${JSON.stringify(cache.values.get('k'))}`);
    }
  }

  {
    const cache = memCache({ k: { id: 7, checkedAt: stale } });
    const err = await rejects(cachedLookup(cache, 'k', lookupOf(httpError(404)), { isValid }));
    if (err === null && cache.values.get('k').id === 7) pass('without isGone, even a 404 on the recheck keeps the cached value');
    else fail(`default isGone wrong: error=${err?.message}, entry=${JSON.stringify(cache.values.get('k'))}`);
  }

  {
    const cache = memCache({ k: { id: 7, checkedAt: stale } });
    const err = await rejects(cachedLookup(cache, 'k', lookupOf(httpError(410)), { isValid, isGone: (e) => e?.status === 410 }));
    if (err?.status === 410 && !cache.values.has('k')) pass('an error isGone accepts deletes the entry and is thrown');
    else fail(`isGone wrong: error=${err?.status}, cached=${cache.values.has('k')}`);
  }

  {
    const cache = memCache();
    const err = await rejects(cachedLookup(cache, 'k', lookupOf(httpError(503)), { isValid }));
    if (err?.status === 503 && cache.values.size === 0) pass('a failed lookup with nothing cached is thrown and stores nothing');
    else fail(`miss failure wrong: error=${err?.status}, size=${cache.values.size}`);
  }

  {
    const cache = memCache({ k: { id: 'not-a-number', checkedAt: fresh } });
    const lookup = lookupOf(8);
    const value = await cachedLookup(cache, 'k', lookup, { isValid });
    if (value === 8 && lookup.calls === 1 && cache.values.get('k').id === 8) pass('a cached value isValid rejects is treated as a miss and replaced');
    else fail(`invalid cached value wrong: value=${value}, calls=${lookup.calls}`);
  }

  {
    const cache = memCache({ k: { id: 'not-a-number', checkedAt: stale } });
    const err = await rejects(cachedLookup(cache, 'k', lookupOf(httpError(503)), { isValid }));
    if (err?.status === 503) pass('a failed lookup never falls back to a cached value isValid rejects');
    else fail(`invalid fallback wrong: error=${err?.status}`);
  }

  {
    const cache = memCache({ k: { id: 7, checkedAt: 'not a date' } });
    const lookup = lookupOf(8);
    const value = await cachedLookup(cache, 'k', lookup, { isValid });
    if (value === 8 && lookup.calls === 1) pass('an entry with no readable checkedAt is checked again');
    else fail(`unreadable checkedAt wrong: value=${value}, calls=${lookup.calls}`);
  }

  {
    const cache = memCache({ k: { id: 7, checkedAt: ago(2 * 60 * 1000) } });
    const lookup = lookupOf(8);
    const value = await cachedLookup(cache, 'k', lookup, { isValid, maxAgeMs: 60 * 1000 });
    if (value === 8 && lookup.calls === 1) pass('maxAgeMs replaces the default recheck age');
    else fail(`maxAgeMs wrong: value=${value}, calls=${lookup.calls}`);
  }

  {
    const lookup = lookupOf(8);
    const first = await cachedLookup(undefined, 'k', lookup, { isValid });
    const second = await cachedLookup(undefined, 'k', lookup, { isValid });
    if (first === 8 && second === 8 && lookup.calls === 2) pass('without a cache every call looks the value up');
    else fail(`no cache wrong: first=${first}, second=${second}, calls=${lookup.calls}`);
  }
} catch (e) {
  fail(`_cached-lookup tests crashed: ${e.message}`);
}
