import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { companySlug } from "@/lib/company-slug.mjs";
import { matchesTailoredCv, sortNewestFirst } from "@/lib/apply/cv-match.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored CV PDF the pdf mode wrote to output/cv-…-{company}-…pdf for
// a given offer (matched by company slug, newest first). Inline so it opens in
// the browser. Local-first: reads the user's own output/ dir. Uses the SAME
// matching contract as resolveTailoredCv (see cv-match.mjs) so this and the
// apply flow always resolve to the same file.
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
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
      .filter((f) => matchesTailoredCv(f.toLowerCase(), slug));
  } catch {
    return new Response("no output directory", { status: 404 });
  }
  if (!files.length) return new Response("no tailored CV found for this offer", { status: 404 });

  const sorted = sortNewestFirst(dir, files);
  if (!sorted.length) return new Response("no tailored CV found for this offer", { status: 404 });
  const file = path.join(dir, sorted[0]);
  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${sorted[0]}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
