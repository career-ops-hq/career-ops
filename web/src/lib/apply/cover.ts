import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, findApplication, isRegularContainedFile } from "@/lib/career-ops";
import { companySlug } from "@/lib/company-slug.mjs";
import { hasToken, matchesTailoredCover, sortNewestFirst } from "./cv-match.mjs";

/** The length generate-cover-letter.mjs truncates a role slug to when it builds
 *  a default output filename (`role.slice(0, 30)`). A role longer than this is
 *  on disk only in its cut form, so both spellings are accepted below. */
const ROLE_SLUG_MAX = 30;

/**
 * Locate the tailored COVER LETTER PDF for an application. Returns an absolute
 * path or null.
 *
 * Async, and taking the tracker application number, to stay the same shape as
 * resolveTailoredCv (#2599) — resolving a tailored artifact by company ALONE
 * is a bug, because two applications at one company then both receive the
 * company's newest file.
 *
 * It cannot fix that the way resolveTailoredCv does, though. That resolver
 * joins the application to data/pdf-index.tsv via pdfPathStatusForReport, and
 * THAT MANIFEST CANNOT REPRESENT A COVER: its header is
 * `# report\tpdf\thtml\tformat\tdate` with no kind column, and
 * updatePDFManifest drops any existing row for a report number before
 * appending, so a cover generated with `--report N` evicts that report's CV
 * row (#3887). Reading a cover back out of it would hand over whichever
 * artifact happened to be written last — sometimes the CV.
 *
 * So the application is identified from the tracker row itself: the cover must
 * carry BOTH the row's company slug and its role slug at token boundaries. If
 * no file on disk identifies this row's role, the answer is null — with two
 * covers for one company and nothing to tell them apart, returning the newest
 * is exactly the #2599 defect. Company-only matching remains for the caller
 * that has no tracker row (a manually pasted URL).
 */
export async function resolveTailoredCover(company?: string, applicationNumber?: string): Promise<string | null> {
  const n = applicationNumber?.trim();
  // A number that names no row resolves nothing rather than silently widening
  // to the company scan, the same way resolveTailoredCv returns null for a row
  // it cannot join.
  const app = n ? findApplication(n) : null;
  if (n && !app) return null;

  const key = companySlug(app?.company ?? company);
  if (!key) return null;
  const dir = path.join(careerOpsRoot(), "output");

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .filter((f) => matchesTailoredCover(f.toLowerCase(), key.slug))
      // sortNewestFirst drops directories and files that vanish under it, but
      // not a symlink PLACED in output/ that resolves elsewhere: that one stats
      // as a regular file. Same realpath guard /api/cv-pdf applies, here rather
      // than in the route so the readiness check and the served file agree.
      .filter((f) => isRegularContainedFile(path.join(dir, f), dir));
  } catch {
    return null;
  }

  if (app) {
    const role = companySlug(app.role)?.slug;
    const wanted = role ? [role, role.slice(0, ROLE_SLUG_MAX)] : [];
    files = files.filter((f) => wanted.some((r) => hasToken(f.toLowerCase(), r)));
  }

  if (!files.length) return null;
  const sorted = sortNewestFirst(dir, files);
  if (!sorted.length) return null;
  return path.join(dir, sorted[0]);
}
