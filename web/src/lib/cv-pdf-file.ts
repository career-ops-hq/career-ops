import fs from "node:fs";
import path from "node:path";
import { styledCvNames } from "@/lib/apply/ats-pdf.mjs";
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

export async function locateTailoredPdf(query: CvPdfSelectors): Promise<LocatedCvPdf> {
  const n = query.n.trim();
  const company = query.company.trim();
  const application = query.application.trim();
  const kind = query.kind === "cover" ? "cover" : "cv";

  if (kind === "cover" && !n) {
    return { status: 404, message: "indexed cover letter is unavailable" };
  }

  if (n) {
    if (!/^\d+$/.test(n)) return { status: 400, message: "invalid report number" };
    const exact = await pdfPathStatusForReport(n, kind);
    if (exact.status === "found") return { file: exact.path };
    if (exact.status === "rejected" || kind === "cover") {
      return {
        status: 404,
        message: kind === "cover" ? "indexed cover letter is unavailable" : "indexed tailored CV is unavailable",
      };
    }
  }

  if (application) {
    const exact = await resolveTailoredCv(undefined, application);
    if (exact) return { file: exact };
  }

  if (!company) return { status: 400, message: "company required" };
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

  const sorted = sortNewestFirst(dir, styledCvNames(files));
  if (!sorted.length) return { status: 404, message: TAILORED_CV_MISSING };
  return { file: path.join(dir, sorted[0]) };
}
