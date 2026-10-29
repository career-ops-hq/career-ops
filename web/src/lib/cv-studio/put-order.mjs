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
 * of the page while another save is still in flight, or when an earlier
 * response may have been lost after writing. The browser can cancel the open
 * request as the page closes, so the exit flush sends that payload again.
 *
 * @param {string} saved - JSON already stored.
 * @param {string} current - JSON on screen.
 * @param {string | null} inflight - JSON of the save that has not finished.
 * @param {boolean} keepalive - True for the page-exit flush.
 * @param {boolean} [uncertain] - A previous response may have been lost after writing.
 */
export function shouldSendEdits(saved, current, inflight, keepalive, uncertain = false) {
  if (current === saved) {
    if (uncertain) return typeof inflight !== "string" || keepalive === true;
    return keepalive === true && typeof inflight === "string" && inflight !== current;
  }
  if (current === inflight && keepalive !== true) return false;
  return true;
}

/**
 * The in-flight payload a page-exit flush can still lose a race to.
 * One that differs from the screen wins, so an undo is sent instead of
 * the autosave or Save for apply that is already on the wire.
 *
 * @param {string | null} saving - Autosave JSON that has not finished.
 * @param {string | null} posting - Save-for-apply JSON that has not finished.
 * @param {string} current - JSON on screen.
 * @returns {string | null}
 */
export function inflightEdits(saving, posting, current) {
  if (typeof posting === "string" && posting !== current) return posting;
  if (typeof saving === "string" && saving !== current) return saving;
  if (typeof saving === "string") return saving;
  if (typeof posting === "string") return posting;
  return null;
}

/**
 * True when Save for apply stored the edits before it answered.
 * Rendering runs after that write, so 422 still means the file changed.
 * A superseded response, or a stale or busy 409, means it did not.
 *
 * @param {number} status
 * @param {boolean} superseded
 */
export function postWroteEdits(status, superseded) {
  if (superseded === true) return false;
  return status === 200 || status === 422;
}

/**
 * Whether to PUT the screen after Save for apply answers.
 * A stored payload that still matches the screen needs nothing. A response
 * that stored nothing still needs the screen, because the autosave timer
 * already elapsed while that request was open.
 *
 * @param {boolean} wrote
 * @param {string} sent
 * @param {string} current
 */
export function shouldPutAfterPost(wrote, sent, current) {
  if (wrote === true) return current !== sent;
  return true;
}

/**
 * @param {string} saved
 * @param {string} current
 * @param {string | null} saving
 * @param {string | null} posting
 * @param {boolean} [uncertain] - A previous response may have been lost after writing.
 * @returns {"Saving" | "Unsaved" | "Saved"}
 */
export function editSaveStatus(saved, current, saving, posting, uncertain = false) {
  const inflight = inflightEdits(saving, posting, current);
  if (inflight === current || (current === saved && inflight !== null)) return "Saving";
  if (current !== saved || uncertain) return "Unsaved";
  return "Saved";
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
