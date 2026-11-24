// _config-utils.mjs — shared config-parsing helpers for provider plugins.
// Files prefixed with _ are never loaded as providers by scan.mjs (see
// _registry.mjs).

/**
 * Clamp a runtime integer into [min, max], falling back to `def` for NaN, so
 * a stray portals.yml value can't produce an empty (e.g. size=0) or
 * pathological query.
 * @param {unknown} val
 * @param {number} def
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function intInRange(val, def, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** @param {string} text */
export const hasControlChar = (text) => [...text].some((c) => c < ' ' || c === '\u007f');

/**
 * Read a user override that must be a positive integer, capped at `cap`, so a
 * portals.yml typo cannot turn one board into an unbounded or ban-prone crawl.
 *
 * Not the same as intInRange(): anything that is not already a positive
 * integer (0, a negative number, 2.5, 'abc', null, '') falls back to
 * `fallback` instead of being clamped or truncated. Only a value over `cap` is
 * clamped. Use this when a bad value should mean "use the default", and
 * intInRange() when it should be pulled into a range.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} cap
 * @returns {number}
 */
export function boundedPositiveInt(value, fallback, cap) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : fallback;
}
