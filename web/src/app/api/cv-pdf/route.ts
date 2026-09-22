import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCv } from "@/lib/apply/cv";
import { careerOpsRoot, isRegularContainedFile, pdfPathStatusForReport } from "@/lib/career-ops";
import { companySlug } from "@/lib/company-slug.mjs";
import { matchesTailoredCv, sortNewestFirst } from "@/lib/apply/cv-match.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function servePdf(file: string): Response {
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${path.basename(file)}"`, "Cache-Control": "no-store" },
  });
}

// Serve the tailored CV PDF the pdf mode wrote to output/ for a given offer.
// Inline so it opens in the browser. Local-first: reads the user's own output/
// dir.
//
// Three resolution paths, in order. "n" (a REPORT number, e.g. from a report's
// own "View tailored CV" link) and "application" (a TRACKER ROW number, e.g.
// from the Apply flow) are different number spaces and both resolve the EXACT
// PDF recorded in data/pdf-index.tsv — application via the row's own Report
// cell. The company slug is the fallback for reports generated before that
// manifest existed. The fallback uses the SAME matching contract as
// resolveTailoredCv (see cv-match.mjs) so this and the apply flow always land
// on the same file.
export async function GET(req: NextRequest) {
  const n = (req.nextUrl.searchParams.get("n") ?? "").trim();
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const application = (req.nextUrl.searchParams.get("application") ?? "").trim();

  // Preferred path: resolve the EXACT PDF indexed for this report number
  // (data/pdf-index.tsv). Two applications at the same company have two
  // different tailored CVs — the company-slug fallback below can't tell them
  // apart and would open the wrong report's PDF.
  if (n) {
    // A malformed n (typo, tampered query string) must not silently fall
    if (!/^\d+$/.test(n)) return new Response("invalid report number", { status: 400 });
    const exact = await pdfPathStatusForReport(n);
    if (exact.status === "found") {
      try {
        return servePdf(exact.path);
      } catch {
        return new Response("could not read the PDF", { status: 500 });
      }
    }
    if (exact.status === "rejected") return new Response("indexed tailored CV is unavailable", { status: 404 });
    // No index entry (e.g. a report generated before pdf-index.tsv existed) —
    // fall through to the company-slug heuristic below rather than 404 on a
    // real, existing tailored CV.
  }

  // Same shape as the "n" path above, but resolved through the tracker row's
  // own Report cell — the join the apply flow's file-upload uses.
  if (application) {
    const exact = await resolveTailoredCv(undefined, application);
    if (exact) {
      try {
        return servePdf(exact);
      } catch {
        return new Response("could not read the PDF", { status: 500 });
      }
    }
    // No resolvable report for this tracker row — fall through to the
    // company-slug heuristic below, same as the "n" path.
  }

  if (!company) return new Response("company required", { status: 400 });
  // Same invariant as the apply lookup: a company with no usable key serves
  // nothing rather than the newest unrelated CV (#2352).
  const key = companySlug(company);
  if (!key) return new Response("no tailored CV found for this offer", { status: 404 });
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
    return new Response("no output directory", { status: 404 });
  }
  if (!files.length) return new Response("no tailored CV found for this offer", { status: 404 });

  const sorted = sortNewestFirst(dir, files);
  if (!sorted.length) return new Response("no tailored CV found for this offer", { status: 404 });
  try {
    return servePdf(path.join(dir, sorted[0]));
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
