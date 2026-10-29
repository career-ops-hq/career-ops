// List search is typed locally so the table does not wait on a navigation.
// The URL still has to catch up: a reload and the browser Back button read
// the list entry, and that entry never used to contain `q`.

export const LIST_SEARCH_DEBOUNCE_MS = 300;

/**
 * A URL write that only sets `q`. The table already filtered locally, so this
 * must not start the route transition that swaps the rows for a skeleton.
 *
 * @param {Record<string, unknown>} updates
 */
export function isSearchOnlyWrite(updates) {
  const keys = Object.keys(updates);
  return keys.length > 0 && keys.every((key) => key === "q");
}

/**
 * The `q` a list navigation will put in the URL. A tab or sort change uses
 * the search typed so far. A search write uses its own `q`.
 *
 * @param {Record<string, string | number | null | undefined>} updates
 * @param {string} live
 * @returns {string}
 */
export function searchQueuedByNavigation(updates, live) {
  if (Object.prototype.hasOwnProperty.call(updates, "q")) {
    const value = updates.q;
    return value == null || value === "" ? "" : String(value);
  }
  return live ?? "";
}

/**
 * Remember a navigation this tab asked for, oldest first. The same value
 * queued twice in a row stays one entry.
 *
 * @param {string[]} expected
 * @param {Record<string, string | number | null | undefined>} updates
 * @param {string} live
 * @returns {string[]}
 */
export function noteNavigation(expected, updates, live) {
  const outgoing = searchQueuedByNavigation(updates, live);
  if (expected[expected.length - 1] === outgoing) return expected;
  return [...expected, outgoing];
}

/**
 * Record a navigation only after the URL change is scheduled. A click that
 * leaves the query as it is must not hide an older search write still on
 * its way.
 *
 * @param {string[]} expected
 * @param {Record<string, string | number | null | undefined>} updates
 * @param {string} live
 * @param {boolean} committed
 * @returns {string[]}
 */
export function rememberNavigation(expected, updates, live, committed) {
  if (!committed) return expected;
  return noteNavigation(expected, updates, live);
}

/**
 * Decide how a local search and the URL `q` stay in step.
 *
 * `expected` is every `q` this tab has asked the router to write and has not
 * seen land, oldest first. A list navigation that included the search belongs
 * there too, or its arrival looks like Back and replaces newer typing.
 * A URL that is not in that list is Back or a shared link: it wins, and the
 * in-flight writes move to `cancelled`. When one of those lands late, write
 * the local query back at once. An older in-flight URL is ignored while a
 * newer write is still out.
 *
 * @param {{ local: string, url: string, urlChanged: boolean, expected?: string[], cancelled?: string[] }} state
 * @returns {{ adopt: boolean, write: string | null, immediate: boolean, expected: string[], cancelled: string[] }}
 */
export function nextSearchWrite({ local, url, urlChanged, expected = [], cancelled = [] }) {
  const inFlight = expected.slice();
  let dropped = cancelled.slice();
  const hold = { adopt: false, write: null, immediate: false, expected: inFlight, cancelled: dropped };

  if (!urlChanged) {
    if (local !== url && inFlight[inFlight.length - 1] !== local) {
      return { ...hold, write: local };
    }
    return hold;
  }

  const idx = inFlight.lastIndexOf(url);
  if (idx === inFlight.length - 1 && idx !== -1) {
    dropped = dropped.filter((item) => item !== url);
    const settled = { ...hold, expected: [], cancelled: dropped };
    if (local === url) return settled;
    return { ...settled, write: local };
  }
  if (idx !== -1) {
    return { ...hold, expected: inFlight.slice(idx + 1) };
  }
  if (dropped.includes(url)) {
    if (local === url) {
      return { ...hold, cancelled: dropped.filter((item) => item !== url) };
    }
    return { ...hold, write: local, immediate: true };
  }

  for (const item of inFlight) {
    if (!dropped.includes(item)) dropped.push(item);
  }
  return { adopt: local !== url, write: null, immediate: false, expected: [], cancelled: dropped };
}

/**
 * Copy of the current query plus `updates`, with the typed search filled in
 * when the caller did not set `q` itself. An empty live search removes `q`.
 *
 * @param {string} current
 * @param {Record<string, string | number | null | undefined>} updates
 * @param {string} live
 * @returns {string}
 */
export function queryWithLiveSearch(current, updates, live) {
  const sp = new URLSearchParams(current);
  const patch = { ...updates };
  if (!Object.prototype.hasOwnProperty.call(updates, "q")) {
    patch.q = live ? live : null;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") sp.delete(key);
    else sp.set(key, String(value));
  }
  return sp.toString();
}
