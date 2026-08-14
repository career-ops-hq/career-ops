import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, pdfPathForReport } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function servePdf(file: string): Response {
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${path.basename(file)}"`, "Cache-Control": "no-store" },
  });
}

// Serve the tailored CV PDF for a given offer. Inline so it opens in the
// browser. Local-first: reads the user's own output/ dir.
export async function GET(req: NextRequest) {
  const n = (req.nextUrl.searchParams.get("n") ?? "").trim();
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();

  // Preferred path: resolve the EXACT PDF indexed for this report number
  // (data/pdf-index.tsv). Two applications at the same company have two
  // different tailored CVs — the company-slug fallback below can't tell them
  // apart and would open the wrong report's PDF.
  if (n) {
    const exact = await pdfPathForReport(n);
    if (exact) {
      try {
        return servePdf(exact);
      } catch {
        return new Response("could not read the PDF", { status: 500 });
      }
    }
    // No index entry (e.g. a report generated before pdf-index.tsv existed) —
    // fall through to the company-slug heuristic below rather than 404 on a
    // real, existing tailored CV.
  }

  if (!company) return new Response("company required", { status: 400 });
  // Token-extract instead of replace-then-trim: same slug, and no `-+$`-style
  // pattern that backtracks polynomially on adversarial input (CodeQL).
  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  const dir = path.join(careerOpsRoot(), "output");
  // Match the slug at a token boundary (delimited by non-alphanumerics) so "Meta"
  // doesn't serve "Metabase"'s tailored CV. The pdf mode names files cv-…-{slug}-….
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .filter((f) => re.test(f.toLowerCase()));
  } catch {
    return new Response("no output directory", { status: 404 });
  }
  if (!files.length) return new Response("no tailored CV found for this offer", { status: 404 });

  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  try {
    return servePdf(path.join(dir, files[0]));
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
