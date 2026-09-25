// How long the web layer lets the core scanner run before it SIGTERMs the child.
//
// A full ATS sweep probes every company in a source's dataset regardless of
// --limit (e.g. Greenhouse's thousands of boards), so a broad scan can outlast
// the default. career-ops is local-first and config-driven, so a user raises the
// budget in config/profile.yml under `scan.timeout_seconds` — the same place
// `scan.extractor` lives. The default keeps a safety margin under the route's
// maxDuration (300s) so the scanner's final JSON can still be parsed and flushed
// before the platform would cut the response.

export const DEFAULT_SCAN_TIMEOUT_MS = 230_000;

/** Resolve the scan timeout (ms) from a parsed profile.yml object, reading
 *  `scan.timeout_seconds`. Never throws; falls back to the default for anything
 *  missing, non-numeric, or not strictly positive (a broken config must not
 *  block scanning). Accepts any value so callers can pass an unparsed profile. */
export function resolveScanTimeoutMs(profile) {
  const scan = profile && typeof profile === "object" && !Array.isArray(profile) ? profile.scan : undefined;
  const raw = scan && typeof scan === "object" && !Array.isArray(scan) ? scan.timeout_seconds : undefined;
  // Accept only numbers and numeric strings — Number(true) is 1, which would
  // otherwise turn `timeout_seconds: true` into a 1s budget instead of the default.
  if (typeof raw !== "number" && typeof raw !== "string") return DEFAULT_SCAN_TIMEOUT_MS;
  if (typeof raw === "string" && raw.trim() === "") return DEFAULT_SCAN_TIMEOUT_MS;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? Math.floor(secs * 1000) : DEFAULT_SCAN_TIMEOUT_MS;
}

/** Honest, actionable message when our own timer stopped the scanner before it
 *  finished — distinct from a genuine "no readable output" parse failure. */
export function scanTimeoutMessage(timeoutMs) {
  // Exact, not rounded: a 1.5s budget must not read as 2s, nor 1ms as 0s.
  const secs = timeoutMs / 1000;
  return (
    `The scan was stopped after ${secs}s before it finished. ` +
    `Narrow the ATS list, lower the per-ATS limit, or raise ` +
    `scan.timeout_seconds in config/profile.yml to give it more time.`
  );
}
