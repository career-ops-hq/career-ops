// The Apply page's two exit decisions (#2734), kept out of the component so
// every branch is testable: whether leaving would lose work, and where "back"
// actually goes.

/** Where back goes when the session recorded no origin (a pasted form URL). */
export const DEFAULT_RETURN_PATH = "/pipeline";

/** Statuses where a step is running that leaving would interrupt. */
const IN_FLIGHT = new Set(["opening", "driving", "prefilling", "filling"]);

/**
 * Should leaving the Apply page ask first?
 *
 * Yes once there is something to lose: an answer with content, or a step still
 * running. A form that was read but never touched backs out in one click, so
 * the confirm stays meaningful instead of becoming something to click through.
 */
export function needsLeaveConfirmation({ status, answers } = {}) {
  if (IN_FLIGHT.has(status)) return true;
  return Object.values(answers ?? {}).some((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * Resolve where back goes, from the origin the apply session recorded.
 *
 * Only a local app path is honoured. Anything that would leave the app, and the
 * Apply page itself (which would reload rather than exit), falls back to the
 * tracker.
 */
export function resolveReturnPath(from) {
  if (typeof from !== "string") return DEFAULT_RETURN_PATH;
  const path = from.trim();
  if (!path.startsWith("/")) return DEFAULT_RETURN_PATH;
  // "//host" and "/\host" are protocol-relative in browsers, not local paths.
  if (path.startsWith("//") || path.startsWith("/\\")) return DEFAULT_RETURN_PATH;
  // A trailing slash reaches the same route, so it has to be refused too.
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (pathname === "/apply") return DEFAULT_RETURN_PATH;
  return path;
}

/**
 * What to do with an apply-session result that arrived after the user left.
 *
 * Leaving mid-open is now reachable (Back works while the form is still
 * opening), and the request in flight cannot be recalled. A stale result must
 * not repopulate the page the user walked away from, and if it opened a session
 * anyway that session has to be closed here: nothing else holds its id, so the
 * headless browser behind it would keep running.
 *
 * @returns {"apply"|"close"|"discard"}
 */
export function resolveLateSession({ stale, sessionId } = {}) {
  if (!stale) return "apply";
  return sessionId ? "close" : "discard";
}
