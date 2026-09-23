import { NextRequest } from "next/server";
import { computeCvJdFit, pdfReadyFlag, readCachedCvFit } from "@/lib/cv-jd-fit";
import { findApplication } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tailored-CV ↔ JD fit (zero-LLM keyword coverage). Not the evaluate score
// (master cv.md) and not the PDF worker VERDICT (file written = 5/5).
export async function GET(req: NextRequest) {
  const report = (req.nextUrl.searchParams.get("report") ?? "").trim();
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (!report) return Response.json({ error: "report required" }, { status: 400 });

  const app = findApplication(report);
  const co = company || app?.company || "";
  const pdfReady = pdfReadyFlag(app?.pdf ?? "");

  if (!pdfReady && !force) {
    return Response.json({
      fitScore: null,
      coveragePct: 0,
      total: 0,
      gaps: [],
      hasCv: false,
      hasJd: false,
      pdfReady: false,
      evaluateScore: app?.score ?? null,
    });
  }

  const fit = computeCvJdFit(report, co, { force }) ?? readCachedCvFit(report);
  if (!fit) {
    return Response.json({
      fitScore: null,
      coveragePct: 0,
      total: 0,
      gaps: [],
      hasCv: pdfReady,
      hasJd: false,
      pdfReady,
      evaluateScore: app?.score ?? null,
      error: "could not compute fit",
    });
  }

  return Response.json({
    ...fit,
    pdfReady,
    evaluateScore: app?.score ?? null,
  });
}
