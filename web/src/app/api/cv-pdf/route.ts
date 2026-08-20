import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored CV PDF the pdf mode wrote to output/cv-…-{company}-…pdf for
// a given offer (matched by company slug, newest first). Inline so it opens in
// the browser. Local-first: reads the user's own output/ dir.
export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") ?? "").trim();
  const fileParam = (req.nextUrl.searchParams.get("file") ?? "").trim();
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const dir = path.join(careerOpsRoot(), "output");

  if (!fs.existsSync(dir)) return new Response("no output directory", { status: 404 });

  if (type === "cv" || fileParam === "cv") {
    const cvFile = path.join(dir, "Venkateswarlu-Pambha-CV.pdf");
    if (fs.existsSync(cvFile)) {
      const buf = fs.readFileSync(cvFile);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Venkateswarlu-Pambha-CV.pdf"`, "Cache-Control": "no-store" },
      });
    }
  }

  if (type === "cover-letter" || fileParam === "cover-letter") {
    const clFile = path.join(dir, "Venkateswarlu-Pambha-Cover-Letter.pdf");
    if (fs.existsSync(clFile)) {
      const buf = fs.readFileSync(clFile);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Venkateswarlu-Pambha-Cover-Letter.pdf"`, "Cache-Control": "no-store" },
      });
    }
  }

  if (fileParam && !fileParam.includes("/") && !fileParam.includes("\\") && fileParam.endsWith(".pdf")) {
    const targetFile = path.join(dir, fileParam);
    if (fs.existsSync(targetFile)) {
      const buf = fs.readFileSync(targetFile);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileParam}"`, "Cache-Control": "no-store" },
      });
    }
  }

  if (!company) {
    // If no specific company requested, find the most recently generated CV PDF
    const allPdfs = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".pdf"));
    if (!allPdfs.length) return new Response("no PDF found", { status: 404 });
    allPdfs.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    const file = path.join(dir, allPdfs[0]);
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${allPdfs[0]}"`, "Cache-Control": "no-store" },
    });
  }

  const slug = (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .filter((f) => re.test(f.toLowerCase()));

  if (!files.length) return new Response("no tailored CV found for this offer", { status: 404 });

  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  const file = path.join(dir, files[0]);
  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${files[0]}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
