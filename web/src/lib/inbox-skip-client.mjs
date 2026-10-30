/** Keep a late Skip failure from replacing feedback for a requested Undo.
 * Each notice owns its actions. Awaiting skip() also awaits failure handling.
 * @param {(done: boolean) => Promise<void>} persistSkip
 * @param {(error: unknown) => void} onSkipFailure
 */
export function createInboxSkipActions(persistSkip, onSkipFailure) {
  let undoRequested = false;
  return {
    skip: async () => {
      try {
        await persistSkip(true);
      } catch (error) {
        if (!undoRequested) onSkipFailure(error);
      }
    },
    undo: () => {
      undoRequested = true;
      return persistSkip(false);
    },
  };
}

/** Serialize writes for one posting while still reporting failures to the UI.
 * A failed request must not poison the chain: the next Undo/retry still runs.
 * @param {Map<string, Promise<void>>} chains
 * @param {string} url
 * @param {boolean} done
 * @param {typeof fetch} [request]
 * @returns {Promise<void>}
 */
export function queueInboxSkip(chains, url, done, request = fetch) {
  const next = (chains.get(url) ?? Promise.resolve()).then(async () => {
    const response = await request("/api/inbox/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, done }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(typeof result?.error === "string" ? result.error : "Could not save the inbox change. Please try again.");
    }
    if (result?.ok !== true || result.done !== done) {
      throw new Error("Could not confirm the inbox change. Please try again.");
    }
  });
  // Only the queue tail absorbs rejection; callers receive the original result.
  const settled = next.catch(() => {});
  chains.set(url, settled);
  void settled.then(() => { if (chains.get(url) === settled) chains.delete(url); });
  return next;
}
