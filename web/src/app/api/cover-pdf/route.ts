import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored cover letter PDF the pdf mode wrote to output/cover-…-{company}-…pdf
// for a given offer (matched by company slug, newest first). Inline so it opens in
// the browser. Local-first: reads the user's own output/ dir.
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  if (!company) return new Response("company required", { status: 400 });
  // Token-extract instead of replace-then-trim: same slug, and no `-+$`-style
  // pattern that backtracks polynomially on adversarial input (CodeQL).
  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  const dir = path.join(careerOpsRoot(), "output");
  // Match the slug at a token boundary (delimited by non-alphanumerics) so "Meta"
  // doesn't serve "Metabase"'s cover letter. The pdf mode names files cover-…-{slug}-….
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf") && f.toLowerCase().startsWith("cover-"))
      .filter((f) => re.test(f.toLowerCase()));
  } catch {
    return new Response("no output directory", { status: 404 });
  }
  if (!files.length) return new Response("no tailored cover letter found for this offer", { status: 404 });

  // Stat once up front instead of inside the comparator: a file deleted between
  // readdirSync and statSync would otherwise throw ENOENT mid-sort (TOCTOU).
  // Vanished files are dropped rather than crashing the lookup.
  const withMtime = files.flatMap((f) => {
    try {
      return [{ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }];
    } catch {
      return [];
    }
  });
  if (!withMtime.length) return new Response("no tailored cover letter found for this offer", { status: 404 });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const file = path.join(dir, withMtime[0].f);
  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${withMtime[0].f}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
