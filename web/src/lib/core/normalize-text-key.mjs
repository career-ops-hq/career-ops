// normalize-text-key.mjs — declared COPY of tracker-parse.mjs's normalizeTextKey.
//
// The browser cannot reach the user's checkout, so this is a mirror by
// necessity (#2666). Source of truth: tracker-parse.mjs. Compare CORE vs MIRROR
// on tests/fixtures/company-key-corpus.json via test-all.mjs §55.7 — do not
// "fix" drift here by hand without re-running that freeze.
//
// Keep the NO-NFD safety property: NFKC first so precomposed dots (ż, ė, ġ)
// stay single code points the U+0307 strip cannot reach; only the combining
// dot that lowercasing a Turkish dotted capital leaves behind is removed.

/**
 * @param {string} value - Raw cell value (company, role, agency, slug, …).
 * @param {string} [separator=''] - Replacement for each run of stripped chars.
 * @returns {string} Case-folded, punctuation-free, script-preserving key.
 */
export function normalizeTextKey(value, separator = '') {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/̇/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, separator)
    .trim();
}

export default normalizeTextKey;
