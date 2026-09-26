/**
 * Unicode-safe company/role matching key — algorithm mirror of the core's
 * `normalizeTextKey` in tracker-parse.mjs (#2569 / #2666).
 *
 * Plain .mjs (same pattern as clean-chips.mjs) so node:test and client bundles
 * can import it without a TS runner or Node-only deps.
 *
 * WHY A COPY EXISTS AT ALL: the live core lives in the user's career-ops
 * checkout and is resolved at runtime via careerOpsRoot() — unavailable in the
 * browser. Server code prefers the live export through getNormalizeTextKey()
 * in text-key.ts; this file is for (a) client components and (b) the last-resort
 * fallback when the core module can't be loaded.
 *
 * Keep the body byte-for-byte aligned with tracker-parse.mjs `normalizeTextKey`
 * (nullish → '', NFKC, lower, \p{L}\p{M}\p{N}, separator). The parity test in
 * tests/lib/normalize-text-key.test.mjs fails the build if they drift.
 *
 * Never reinstate [^a-z0-9]: that deleted every non-ASCII letter ("Škoda"→"koda",
 * "日本電産"→""), which both suppressed real offers and resurfaced evaluated ones.
 */

/**
 * @param {unknown} value
 * @param {string} [separator='']
 * @returns {string}
 */
export function normalizeTextKey(value, separator = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    // Mirrors the core exactly, including this step: lowercasing a Turkish
    // dotted capital leaves a combining dot behind (`'İ'.toLowerCase()` is
    // `i` + U+0307), so the key drifts from the visually identical plain `i`.
    // NO `NFD`: NFKC leaves ż/ė/ġ as single precomposed code points the strip
    // cannot reach, while `i` + U+0307 has no precomposed form. Decomposing
    // first would collapse Żubr/Zubr and Ėmė/Eme.
    // Kept byte-for-byte in step with tracker-parse.mjs — test-all §55.7
    // compares the two and fails on any divergence.
    .replace(/̇/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, separator)
    .trim();
}
