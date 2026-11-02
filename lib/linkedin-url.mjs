/**
 * linkedin-url.mjs — read a LinkedIn job-posting URL.
 *
 * The `linkedin` rung of liveness-api.mjs kept this parser inside its
 * ATS_PROVIDERS entry, where nothing else could import it, and url-key.mjs
 * carried a second copy for aggregatorPostingId. It lives here so there is one
 * body to import and to test parity against.
 *
 * No imports and no Node-only APIs (only the global `URL`), so a browser bundle
 * can load it as well as the CLI.
 */

/**
 * The numeric LinkedIn job id carried by this URL, or null when it is not one
 * posting. Matched as digits only, so nothing user-supplied is ever spliced
 * into a hostname.
 *
 * The host test is anchored at a label boundary, so regional subdomains
 * (uk.linkedin.com) match and "linkedin.com.evil.example" never does.
 * `u.hostname` is already lowercased by the URL parser. The protocol is not
 * checked here: callers decide that (resolveAtsApi refuses anything but https).
 *
 * @param {URL} u
 * @returns {string|null}
 */
export function linkedInJobId(u) {
  if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
  return linkedInPathJobId(u);
}

/**
 * The job id in the path or query of a URL already known to be on LinkedIn,
 * without checking the host. For callers that matched the host their own way:
 * url-key.mjs folds trailing dots before it decides a URL is on linkedin.com.
 *
 * Four recognized shapes:
 *   /jobs/view/{id}
 *   /jobs/view/{title-slug}-{id}
 *   /comm/jobs/view/{id}, the link in every LinkedIn email. Verified against
 *     linkedin.com itself: `/comm/jobs/view/{id}?trk=…` answers 307 with
 *     `session_redirect=/jobs/view/{id}?trk=…`, the same id with `/comm` dropped.
 *   any page carrying the posting in ?currentJobId= (search and collection views)
 *
 * @param {URL} u
 * @returns {string|null}
 */
export function linkedInPathJobId(u) {
  const path = u.pathname.match(/^\/(?:jobs\/view\/(?:.*-)?|comm\/jobs\/view\/)(\d+)\/?$/);
  if (path) return path[1];
  const current = u.searchParams.get('currentJobId');
  return current && /^\d+$/.test(current) ? current : null;
}

/**
 * The public guest endpoint for a posting id: the rendered posting as HTML, with
 * no auth and no browser. Pass only an id returned by `linkedInJobId`, so the
 * host stays a fixed literal and nothing user-supplied reaches it.
 *
 * @param {string} id
 * @returns {string}
 */
export function linkedInGuestUrl(id) {
  return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
}
