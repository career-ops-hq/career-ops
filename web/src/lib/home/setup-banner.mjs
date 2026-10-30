/** localStorage key for a dismissed setup banner. */
export const SETUP_BANNER_KEY = "career-ops:setup-banner";

/**
 * Fingerprint of the files doctor still wants. Order does not matter.
 * A later missing file produces a different key, so the banner returns.
 *
 * @param {string[] | null | undefined} missing
 * @returns {string}
 */
export function setupBannerDismissKey(missing) {
  const keys = Array.isArray(missing) ? missing.map((item) => String(item)) : [];
  return keys.slice().sort().join("\n");
}

/**
 * @param {string | null | undefined} stored
 * @param {string[] | null | undefined} missing
 * @returns {boolean}
 */
export function bannerStaysDismissed(stored, missing) {
  if (typeof stored !== "string" || stored.length === 0) return false;
  return stored === setupBannerDismissKey(missing);
}
