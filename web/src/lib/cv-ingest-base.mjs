/**
 * The file the ingest screen read before review. Start over forgets it.
 * Accepting the file on disk replaces it. A save never reads again by itself.
 *
 * @param {{ content: string, exists: boolean } | null} base
 * @param {{ forget?: boolean, accept?: { content: string, exists: boolean } | null }} [action]
 * @returns {{ content: string, exists: boolean } | null}
 */
export function nextIngestBase(base, action = {}) {
  if (action.forget) return null;
  if (action.accept) return { content: action.accept.content, exists: action.accept.exists };
  return base;
}

/** @param {{ content: string, exists: boolean } | null} base */
export function canReviewIngest(base) {
  return base !== null;
}

/**
 * A save posts only the base review already has. A missing read, or a
 * conflict the person has not accepted, does not fetch a newer file.
 *
 * @param {{ content: string, exists: boolean } | null} base
 * @param {{ conflict?: boolean }} [opts]
 * @returns {{ post: false, reason: "missing" | "conflict" } | { post: true, base: { content: string, exists: boolean } }}
 */
export function planIngestSave(base, opts = {}) {
  if (!base) return { post: false, reason: "missing" };
  if (opts.conflict) return { post: false, reason: "conflict" };
  return { post: true, base };
}
