import { companySlug } from "./company-slug.mjs";
import { matchesTailoredCv } from "./apply/cv-match.mjs";

/** Plain-text body for a CV download that has nothing to serve. */
export const TAILORED_CV_MISSING =
  "No tailored CV file for this offer. On the report, choose Generate tailored CV.";

/**
 * A View link is honest only when a file is on disk: the pdf index found one,
 * or output/ has a cv-* file whose name matches this company. A tracker check
 * mark is not a file and is not an input here.
 *
 * indexStatus is pdfPathStatusForReport's status. A rejected index row makes
 * /api/cv-pdf answer 404 without trying names, so it is not ready either.
 * Only a report with no usable index row falls back to the filename match.
 *
 * @param {{ indexStatus?: "found" | "rejected" | "not-found" | "invalid", filenames?: string[], company?: string }} input
 * @returns {boolean}
 */
export function tailoredCvOnDisk({ indexStatus = "not-found", filenames = [], company = "" } = {}) {
  if (indexStatus === "found") return true;
  if (indexStatus === "rejected") return false;
  const key = companySlug(company);
  if (!key?.slug) return false;
  for (const name of filenames) {
    if (typeof name !== "string") continue;
    if (matchesTailoredCv(name.toLowerCase(), key.slug)) return true;
  }
  return false;
}
