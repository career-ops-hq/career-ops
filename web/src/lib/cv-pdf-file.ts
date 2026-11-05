import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCv } from "@/lib/apply/cv";
import { matchesTailoredCv, sortNewestFirst } from "@/lib/apply/cv-match.mjs";
import { careerOpsRoot, isRegularContainedFile, pdfPathStatusForReport } from "@/lib/career-ops";
import { companySlug } from "@/lib/company-slug.mjs";
import { TAILORED_CV_MISSING } from "@/lib/tailored-cv-ready.mjs";

export type CvPdfSelectors = {
  n: string;
  company: string;
  application: string;
  kind: "cv" | "cover";
};

export type LocatedCvPdf = { file: string } | { status: number; message: string };

// The PDF the cv-pdf and cv-reveal routes are allowed to touch. "n" (a REPORT
// number) and "application" (a TRACKER ROW number) are different number spaces
// and both resolve the EXACT PDF recorded in data/pdf-index.tsv. The company
// slug is the fallback for reports generated before that manifest existed.
// The fallback uses the SAME matching contract as resolveTailoredCv (see
// cv-match.mjs) so this and the apply flow always land on the same file.
export async function locateTailoredPdf(query: CvPdfSelectors): Promise<LocatedCvPdf> {
  const n = query.n.trim();
  const company = query.company.trim();
  const application = query.application.trim();
  const kind = query.kind === "cover" ? "cover" : "cv";

  // Cover letters only resolve through the report-number index. The application
  // and company-slug paths below are CV-only and would serve a tailored CV under
  // a cover link when kind=cover arrives without n.
  if (kind === "cover" && !n) {
    return { status: 404, message: "indexed cover letter is unavailable" };
  }

  // Preferred path: resolve the EXACT PDF indexed for this report number
  // (data/pdf-index.tsv). Two applications at the same company have two
  // different tailored CVs. The company-slug fallback below can't tell them
  // apart and would open the wrong report's PDF.
  // kind=cover reads the cover row and stops. Falling through would serve a CV
  // from the company-slug scan under a cover link.
  if (n) {
    // A malformed n (typo, tampered query string) must not silently fall
    if (!/^\d+$/.test(n)) return { status: 400, message: "invalid report number" };
    const exact = await pdfPathStatusForReport(n, kind);
    if (exact.status === "found") return { file: exact.path };
    if (exact.status === "rejected" || kind === "cover") {
      return {
        status: 404,
        message: kind === "cover" ? "indexed cover letter is unavailable" : "indexed tailored CV is unavailable",
      };
    }
    // No index entry (e.g. a report generated before pdf-index.tsv existed).
    // Fall through to the company-slug heuristic below rather than 404 on a
    // real, existing tailored CV.
  }

  // Same shape as the "n" path above, but resolved through the tracker row's
  // own Report cell. That is the join the apply flow's file-upload uses.
  if (application) {
    const exact = await resolveTailoredCv(undefined, application);
    if (exact) return { file: exact };
    // No resolvable report for this tracker row. Fall through to the
    // company-slug heuristic below, same as the "n" path.
  }

  if (!company) return { status: 400, message: "company required" };
  // Same invariant as the apply lookup: a company with no usable key serves
  // nothing rather than the newest unrelated CV (#2352).
  const key = companySlug(company);
  if (!key) return { status: 404, message: TAILORED_CV_MISSING };
  const { slug } = key;
  const dir = path.join(careerOpsRoot(), "output");

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .filter((f) => matchesTailoredCv(f.toLowerCase(), slug))
      // sortNewestFirst already drops directories and files that vanish under
      // it, but not a symlink PLACED in output/ that resolves elsewhere: that
      // one stats as a regular file and would be served. The realpath check is
      // the same one the indexed path above applies.
      .filter((f) => isRegularContainedFile(path.join(dir, f), dir));
  } catch {
    return { status: 404, message: TAILORED_CV_MISSING };
  }
  if (!files.length) return { status: 404, message: TAILORED_CV_MISSING };

  const sorted = sortNewestFirst(dir, files);
  if (!sorted.length) return { status: 404, message: TAILORED_CV_MISSING };
  return { file: path.join(dir, sorted[0]) };
}
