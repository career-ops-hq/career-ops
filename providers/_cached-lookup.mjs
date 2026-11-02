// @ts-check
// A value a provider resolves with one request (a board id that only a
// careers page shows) and keeps in `ctx.idCache` between scans
// (provider-id-cache.mjs). Shared so every provider applies the same rules:
//
//   - a cached value younger than `maxAgeMs` (DEFAULT_RECHECK_MS unless the
//     provider passes its own) is used without a request;
//   - an older one is looked up again, and the new value replaces it;
//   - when that lookup fails with an error the provider's `isGone` accepts,
//     the board is gone: the entry is deleted and the error is rethrown, so
//     the scan reports the board as unreachable;
//   - any other failure of a lookup keeps using the value already known,
//     including a page in an unexpected shape, so `lookup` should throw when
//     it cannot read the value rather than return a bad one;
//   - without `ctx.idCache` every call looks up.
//
// `isGone` is per provider because only the provider knows what a failed
// lookup proves.
//
// The cached entry is `{ id, checkedAt }`.

export const DEFAULT_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @template T
 * @param {{ get: (key: string) => any, set: (key: string, value: any) => void, delete: (key: string) => void } | undefined} cache
 * @param {string} key
 * @param {() => Promise<T>} lookup - Resolves the value; throws on failure.
 * @param {{ isValid: (value: unknown) => boolean, isGone?: (err: any) => boolean, maxAgeMs?: number }} opts
 * @returns {Promise<T>}
 */
export async function cachedLookup(cache, key, lookup, { isValid, isGone = () => false, maxAgeMs = DEFAULT_RECHECK_MS }) {
  const cached = cache?.get(key);
  const known = cached && isValid(cached.id) ? cached.id : undefined;
  const checkedAt = Date.parse(cached?.checkedAt ?? '');
  if (known !== undefined && Number.isFinite(checkedAt) && Date.now() - checkedAt < maxAgeMs) return known;

  let value;
  try {
    value = await lookup();
  } catch (err) {
    if (isGone(err)) {
      cache?.delete(key);
      throw err;
    }
    if (known !== undefined) return known;
    throw err;
  }
  cache?.set(key, { id: value, checkedAt: new Date().toISOString() });
  return value;
}
