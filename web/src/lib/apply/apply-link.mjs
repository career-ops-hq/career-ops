// Whether an <a href> found on a posting page can be followed as the link to
// its application form. A job board's "Powered by Recruitee/Greenhouse/…"
// logo matches the ATS host selector but points at the vendor's homepage, and
// following it leaves the posting. Only an absolute http(s) URL with a path
// past "/" qualifies, and never a submit URL.

/**
 * @param {unknown} href
 * @returns {boolean}
 */
export function isApplicationHref(href) {
  if (typeof href !== "string" || !/^https?:\/\//i.test(href) || /submit/i.test(href)) return false;
  try {
    return new URL(href).pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}
