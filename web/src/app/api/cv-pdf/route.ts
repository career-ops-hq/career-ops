import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCv } from "@/lib/apply/cv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored CV PDF (cv-*.pdf only) for a given offer. Inline so it
// opens in the browser. Prefers pdf-index.tsv when ?report= is set.
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const report = (req.nextUrl.searchParams.get("report") ?? "").trim();
  if (!company && !report) return new Response("company or report required", { status: 400 });

  const file = resolveTailoredCv(company, report);
  if (!file) return new Response("no tailored CV found for this offer", { status: 404 });

  try {
    const buf = fs.readFileSync(file);
    const name = path.basename(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
