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

/** Tell the caller as soon as one skip fails. The returned promise waits for the whole batch.
 * @param {Promise<unknown>[]} tasks
 * @param {(index: number) => void} onReject
 * @returns {Promise<void>}
 */
export function reportSkipRejections(tasks, onReject) {
  return Promise.allSettled(tasks.map((task, index) => Promise.resolve(task).catch(() => {
    onReject(index);
  }))).then(() => {});
}

/** Unhide each restored URL as soon as that request succeeds.
 * A later failure still rejects, after the successes have been reported.
 * @param {string[]} urls
 * @param {(url: string) => Promise<void>} persist
 * @param {(url: string) => void} onRestored
 * @returns {Promise<void>}
 */
export function restoreSkippedUrls(urls, persist, onRestored) {
  const failures = [];
  return Promise.all(urls.map((url) => Promise.resolve()
    .then(() => persist(url))
    .then(() => { onRestored(url); })
    .catch((error) => { failures.push(error); }),
  )).then(() => {
    if (failures.length === 0) return;
    const error = failures[0];
    if (error instanceof Error) throw error;
    throw new Error("Could not undo every skip. Please try again.");
  });
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
