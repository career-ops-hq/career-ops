// tests/helpers/browser-channel.mjs — which browser the Playwright suites launch.
//
// The suites launch Google Chrome (`channel: "chrome"`), which GitHub's
// ubuntu-latest image ships, so CI runs them against a real Chrome. On a
// developer's machine that same channel opens their own installed Chrome, which
// pops up in the Dock or taskbar once per suite. Setting
// CAREER_OPS_TEST_BROWSER_CHANNEL=bundled launches Playwright's bundled Chromium
// instead (install it once with `npx playwright install chromium`). Unset, the
// suites keep launching Chrome, so CI does not change.

export const TEST_BROWSER_CHANNEL_ENV = "CAREER_OPS_TEST_BROWSER_CHANNEL";

/**
 * The `channel` option for chromium.launch() in the web test suites.
 *
 * @param {Record<string, string|undefined>} [env] - Defaults to process.env.
 * @returns {string|undefined} "chrome" when the variable is unset or empty,
 *   undefined (Playwright's bundled Chromium) for "bundled", and any other value
 *   as given (e.g. "chrome-beta", "msedge"), for Playwright to validate.
 */
export function testBrowserChannel(env = process.env) {
  const value = (env[TEST_BROWSER_CHANNEL_ENV] ?? "").trim();
  if (value === "") return "chrome";
  if (value === "bundled") return undefined;
  return value;
}
