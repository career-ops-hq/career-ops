// tests/helpers/live-server.mjs — the skip condition for the *.browser.test.mjs
// suites, which drive Chrome against a running web server (#5764).
//
// Each suite needs a server URL (and some the data root it was started on) in
// env vars. Without them it skips, which is right on a contributor's machine and
// in `npm test`. tests/browser-suites.mjs starts a server per suite and sets
// those vars, plus CAREER_OPS_REQUIRE_WEB_SERVER=1: there a missing var means
// the runner and the suite disagree on a name, so it fails instead of turning
// the run green without running the suite. Same idea as the core's
// CAREER_OPS_REQUIRE_BROWSER switch (#5758), with a variable of its own because
// the root required check also runs these suites, with no server.

export const REQUIRE_WEB_SERVER_ENV = "CAREER_OPS_REQUIRE_WEB_SERVER";

/**
 * The node:test `skip` value for a suite that needs these env vars.
 *
 * @param {...string} names - The env vars the suite reads.
 * @returns {string|false} A skip reason, or false when every var is set.
 * @throws {Error} When a var is missing and the run requires a live server.
 */
export function liveServerSkip(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length === 0) return false;
  if (process.env[REQUIRE_WEB_SERVER_ENV] === "1") {
    throw new Error(`${missing.join(", ")} not set, and ${REQUIRE_WEB_SERVER_ENV}=1 makes a skipped browser suite a failure`);
  }
  return `needs a running web server: set ${missing.join(" and ")} (or run npm run test:browser)`;
}
