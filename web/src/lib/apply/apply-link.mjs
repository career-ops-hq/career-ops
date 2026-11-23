// Whether an <a href> found on a posting page can be followed as the link to
// its application form. A job board's "Powered by Recruitee/Greenhouse/…"
// logo matches the ATS host selector but points at the vendor's own site, and
// following it leaves the posting. Only an absolute http(s) URL with a path
// past "/" qualifies, never a submit URL, and never a page on the vendor's own
// marketing site (recruitee.com/privacy, www.greenhouse.io/careers). Postings
// live on a subdomain such as jobs.lever.co or acme.recruitee.com.

// The vendors' own sites, reached bare or through www.
const VENDOR_SITES = new Set([
  "ashbyhq.com",
  "greenhouse.io",
  "greenhouse.com",
  "lever.co",
  "smartrecruiters.com",
  "workable.com",
  "recruitee.com",
  "bamboohr.com",
  "jobvite.com",
  "teamtailor.com",
  "icims.com",
  "ultipro.com",
  "ultipro.ca",
  "workday.com",
]);

/**
 * @param {unknown} href
 * @returns {boolean}
 */
export function isApplicationHref(href) {
  if (typeof href !== "string" || !/^https?:\/\//i.test(href) || /submit/i.test(href)) return false;
  try {
    const url = new URL(href);
    if (VENDOR_SITES.has(url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, ""))) return false;
    return url.pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}
