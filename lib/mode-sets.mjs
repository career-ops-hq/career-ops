// lib/mode-sets.mjs — which `modes/<dir>/` directories are translations and
// which are market sets.
//
// Both kinds have a short lowercase directory name, so a name pattern alone
// cannot tell them apart. `modes/at/`, `modes/in/` and `modes/sg/` are English
// modes with an Austrian, Indian or Singaporean market layer on top: each
// README is titled "<Country> market mode" and defers everything it does not
// override to the base modes. A translation mirror (`modes/de/`, `modes/zh-TW/`)
// re-states the base modes in another language.
//
// Tools that treated the market sets as translations got both directions
// wrong: i18n-drift.mjs scored them at about a third "translated", and
// validate-untrusted-content-coverage.mjs skipped them as localized mirrors,
// so their ingesting modes were never checked for the untrusted-content
// marker. tests/mode-sets.test.mjs keeps this list in step with the README
// titles, so a new market set that is missing here fails the suite.

/** Shape of a `modes/` subdirectory that can hold a language or market set. */
const SET_DIR_NAME = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/;

/** English market sets: the base modes plus one market's rules, not a translation. */
export const MARKET_MODE_SETS = Object.freeze(['at', 'in', 'sg']);

/** @param {string} name - A `modes/` subdirectory name. */
export function isMarketModeSet(name) {
  return MARKET_MODE_SETS.includes(name);
}

/**
 * @param {string} name - A `modes/` subdirectory name.
 * @returns {boolean} whether the directory is a translation of the base modes.
 */
export function isLanguageModeSet(name) {
  return typeof name === 'string' && SET_DIR_NAME.test(name) && !isMarketModeSet(name);
}

/**
 * @param {string} rel - A repo-relative path with `/` separators.
 * @returns {boolean} whether the path lies inside a translation mirror, `modes/<lang>/…`.
 */
export function isLanguageMirrorPath(rel) {
  const parts = rel.split('/');
  return parts.length > 2 && parts[0] === 'modes' && isLanguageModeSet(parts[1]);
}
