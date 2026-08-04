// Pure JS helper for the AI-search <<offer:>> stream parser — no TypeScript
// types so it can be imported directly by both explore-ai.ts (which uses it)
// and test-stream-parse.mjs (which can't import .ts without a runner). This is
// the single source of truth for the "how much of a possibly-split opener do we
// hold back?" logic — the load-bearing part of never dropping an offer whose
// `<<offer:` marker straddles a stream chunk boundary (#2290).

/**
 * Length of the trailing run of `buf` that is a proper prefix of `opener` —
 * i.e. a possibly-split opener to buffer rather than flush as narration.
 *
 * Returns the LONGEST such suffix length (0 if none). The previous code checked
 * only whether the fixed last `opener.length - 1` characters formed a prefix,
 * which missed shorter partial openers (`<<`, `<<off`) preceded by other text
 * and dropped the offer once the rest of the marker arrived (#2290).
 *
 * @param {string} buf - Current parse buffer with no full `opener` in view.
 * @param {string} opener - The envelope opener, e.g. "<<offer:".
 * @returns {number} Number of trailing chars to keep buffered (0 = flush all).
 */
export function pendingOpenerLen(buf, opener) {
  const max = Math.min(buf.length, opener.length - 1);
  for (let k = max; k > 0; k--) {
    if (buf.endsWith(opener.slice(0, k))) return k;
  }
  return 0;
}
