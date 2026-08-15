// Classifies how a discovery run failed. Plain .mjs (same pattern as
// clean-chips.mjs) so tests/lib/explore-error.test.mjs can import it without a
// TS runner, and so the API route and the client classify from ONE definition.
//
// A run fails in two structurally different ways, and the Explore UI must tell
// them apart:
//
//   1. The scanner is ABSENT from this checkout: a data-only or pre-onboarding
//      install. /api/explore reports this BEFORE any stream starts. This is the
//      only failure the "Discovery needs the full toolkit" panel should cover,
//      because its call to action is "update career-ops".
//
//   2. The scanner RAN but errored: a transient/runtime failure surfaced through
//      the response stream after a 200 (e.g. "The scanner returned no readable
//      output."). The checkout is fine; the right next step is a retry.
//
// Decide on an explicit CODE in the response body, never on the free text of the
// error message and never on the HTTP status alone.
//
// Not the text, because runtime errors routinely contain the word "scanner" (and
// phrases like "isn't available"), so matching their text misreports a transient
// failure as a broken checkout and tells the user to update when nothing is
// wrong. That was the original defect.
//
// Not the status, because 400 is a SHARED channel and reading it as one meaning
// reintroduces the same misdiagnosis one layer up. /api/explore/ai alone returns
// three different 400s — malformed JSON, missing parameters, and MODE_MISSING —
// and a status-keyed check classified every one of them as "this checkout has no
// scanner". MODE_MISSING is the sharpest case: a real missing-capability error
// with its own copy, replaced by the scanner panel's. A code is a channel of its
// own, so a new 400 added tomorrow is a plain failure by default rather than
// silently inheriting the panel.
//
// This mirrors { code: "MODE_MISSING" } in app/api/explore/ai/route.ts, which is
// the established pattern for this in the app.

/** Machine-readable marker for "the scanner is absent from this checkout". */
export const SCANNER_MISSING_CODE = "SCANNER_MISSING";

/** HTTP status the route pairs with the code. Kept for the route; not a classifier. */
export const SCANNER_MISSING_STATUS = 400;

/** Default copy for the panel. Lives here so the route and its test share one string. */
export const SCANNER_MISSING_MESSAGE = "The discovery scanner isn't available in this checkout yet.";

/**
 * The exact JSON body the route returns for case 1.
 *
 * The route builds its response from this rather than an inline literal so the
 * producer and the classifier below cannot drift apart — a code the client
 * matches but the server never sends fails silently and looks like a UI bug.
 *
 * @param {string} [message] Override copy; defaults to SCANNER_MISSING_MESSAGE.
 */
export function scannerMissingBody(message = SCANNER_MISSING_MESSAGE) {
  return { code: SCANNER_MISSING_CODE, error: message };
}

/**
 * True only for the "scanner absent from this checkout" failure (case 1).
 *
 * Takes the PARSED RESPONSE BODY, not the HTTP status. Callers reach this on a
 * failure path where the body is whatever the server actually sent, so a missing,
 * null, or non-object body is a plain failure rather than an error — anything
 * unrecognised must fall through to the retry path, never to "update your
 * install".
 *
 * @param {unknown} body Parsed JSON response body.
 */
export function isScannerMissing(body) {
  return (
    typeof body === "object" &&
    body !== null &&
    /** @type {{code?: unknown}} */ (body).code === SCANNER_MISSING_CODE
  );
}
