// @ts-check
// encodeURIComponent for a job-URL path segment: returns null when the value
// holds a lone surrogate, instead of letting encodeURIComponent throw URIError.
//
// encodeURIComponent throws URIError when its argument contains a lone UTF-16
// surrogate — a high (0xD800–0xDBFF) or low (0xDC00–0xDFFF) code unit not
// paired with its counterpart. A JSON string can carry one (a "\uD800" escape
// survives JSON.parse), so a job id/slug/refnr taken from an API response can
// reach here ill-formed. A provider that builds job URLs in a `.map()` / `for`
// loop and calls this once per posting drops just the bad posting on a null
// return, instead of a URIError aborting the loop and losing every job on the
// page.
//
// The failure return is null — never the raw value, never a U+FFFD-substituted
// String.prototype.toWellFormed() result. A lone surrogate in a job URL flows
// on into data/scan-history.tsv, the tracker, and generated documents, where it
// serializes to ill-formed UTF-8. Some callers also use the encoded value as a
// dedup key, where a substituted value would collide distinct bad postings onto
// one key.
//
// Scope: a host-controlled value from an API response becoming a job-URL path
// segment inside a loop. Config-derived values (a portals.yml company slug, a
// search keyword, a locale), calls already inside their own try/catch, and
// values already checked against a slug charset do not need it — and for the
// config case, dropping a real job over a bad config character is the wrong
// trade.

/**
 * encodeURIComponent(String(value)), returning null instead of throwing
 * URIError when `value` contains a lone surrogate.
 *
 * @param {unknown} value
 * @returns {string | null} the encoded string, or null when `value` cannot be
 *   URI-encoded. Callers drop the job on null.
 */
export function safeEncodeURIComponent(value) {
  try {
    return encodeURIComponent(String(value));
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
  }
}
