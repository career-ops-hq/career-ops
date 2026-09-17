import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { companySlug } from "@/lib/company-slug.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored cover letter the `cover` mode wrote to output/ for a given
// offer. Inline so it opens in the browser. Local-first: reads the user's own
// output/ dir.
//
// "application" is a TRACKER ROW number and is the preferred key: it resolves
// the cover for THAT application rather than the company's newest (#2599's rule,
// applied to covers). "company" is the fallback for a caller with no tracker row.
//
// Every part of "which file is the cover" lives in resolveTailoredCover — the
// normalization, the matching, the scan and the newest-first pick — per web/'s
// rule 1 (orchestrate the core, never reimplement it). An earlier revision of
// this route carried its own copy of all four, which is precisely how the
// "View cover" link and the check that decides whether to render it start
// disagreeing about which file exists (CodeRabbit, 2026-09-03).
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const application = (req.nextUrl.searchParams.get("application") ?? "").trim();

  // With no application to resolve through, a company is required — and a
  // company that is all punctuation ("!!!") slugs to nothing, which is a bad
  // request rather than a miss. resolveTailoredCover returns null for both, so
  // the distinction has to be drawn here to keep the 400.
  if (!application && !companySlug(company)) return new Response("company required", { status: 400 });

  const file = await resolveTailoredCover(company, application);
  if (!file) return new Response("no tailored cover letter found for this offer", { status: 404 });

  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${path.basename(file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
