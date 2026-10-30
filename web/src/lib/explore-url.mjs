/**
 * The URL Explore writes once a Discover run or an AI hunt has settled, so the
 * search stays shareable and a reload does not replay an onboarding `?run=1`.
 *
 * It is not written while the request is in flight: that write is what cut
 * Discover short. The run lives in the app-shell provider and can outlast the
 * visit to /explore, so a run that settles on another page leaves that page's
 * URL alone.
 *
 * Plain .mjs so tests/lib/explore-url.test.mjs can import it without a TS runner.
 *
 * @param {string} pathname current `location.pathname`
 * @param {string} qs query string without the leading `?` (may be empty)
 * @returns {string | null} the URL to write, or null to leave the URL alone
 */
export function settledExploreUrl(pathname, qs) {
  if (pathname !== "/explore" && pathname !== "/explore/") return null;
  return `/explore${qs ? `?${qs}` : ""}`;
}
