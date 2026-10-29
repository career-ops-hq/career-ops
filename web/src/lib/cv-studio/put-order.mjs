/**
 * Autosave PUTs can reach the server out of order. When the page is leaving,
 * the Studio sends its latest edits at once with keepalive instead of waiting
 * behind an autosave that is still in flight, so the two requests race. Each
 * tab numbers its PUTs, and a write older than one already applied from the
 * same tab is dropped.
 */

const MAX_TABS = 500;

/**
 * Whether this payload should be sent.
 *
 * A payload the server already has is not sent again, except on the way out
 * of the page while a different payload is still in flight. That in-flight
 * save can land after the tab is gone, and the page can no longer correct it.
 *
 * @param {string} saved - JSON already stored.
 * @param {string} current - JSON on screen.
 * @param {string | null} inflight - JSON of the save that has not finished.
 * @param {boolean} keepalive - True for the page-exit flush.
 */
export function shouldSendEdits(saved, current, inflight, keepalive) {
  if (current === saved) return keepalive === true && typeof inflight === "string" && inflight !== current;
  if (current === inflight && keepalive !== true) return false;
  return true;
}

export function createPutOrder() {
  /** @type {Map<string, number>} */
  const last = new Map();
  return {
    /**
     * Call right before the write, with no await in between.
     *
     * @param {string} key - The report the edits belong to.
     * @param {unknown} tab - The sending tab's id. Without one the write is applied.
     * @param {unknown} rev - The tab's PUT number.
     * @returns {boolean} False when this tab already applied a newer PUT.
     */
    accept(key, tab, rev) {
      if (typeof tab !== "string" || tab.length === 0 || tab.length > 64 || !Number.isSafeInteger(rev)) return true;
      const id = `${key}\n${tab}`;
      const prev = last.get(id);
      if (prev !== undefined && /** @type {number} */ (rev) <= prev) return false;
      last.delete(id);
      last.set(id, /** @type {number} */ (rev));
      if (last.size > MAX_TABS) last.delete(last.keys().next().value);
      return true;
    },
  };
}
