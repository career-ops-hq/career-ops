// Classifies how a discovery run failed. Plain .mjs (same pattern as
// clean-chips.mjs) so test-explore-error.mjs can import it without a TS runner.
//
// A run fails in two structurally different ways, and the Explore UI must tell
// them apart:
//
//   1. The scanner is ABSENT from this checkout: a data-only or pre-onboarding
//      install. /api/explore returns an HTTP 400 for this BEFORE any stream
//      starts. This is the only failure the "Discovery needs the full toolkit"
//      panel should cover, because its call to action is "update career-ops".
//
//   2. The scanner RAN but errored: a transient/runtime failure surfaced through
//      the response stream after a 200 (e.g. "The scanner returned no readable
//      output."). The checkout is fine; the right next step is a retry.
//
// Decide on the STRUCTURED signal, the HTTP status the route uses for case 1,
// never on the free text of the error message. Runtime errors routinely contain
// the word "scanner" (and phrases like "isn't available"), so matching their text
// misreports a transient failure as a broken checkout and tells the user to
// update when nothing is wrong.
export const SCANNER_MISSING_STATUS = 400;

/** True only for the "scanner absent from this checkout" failure (case 1). */
export function isScannerMissing(status) {
  return status === SCANNER_MISSING_STATUS;
}
