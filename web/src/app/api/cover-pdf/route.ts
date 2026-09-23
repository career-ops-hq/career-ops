import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveCoverLetter } from "@/lib/apply/cv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the cover letter PDF (*-cover.pdf only) for a given company slug.
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  if (!company) return new Response("company required", { status: 400 });

  const file = resolveCoverLetter(company);
  if (!file) return new Response("no cover letter PDF found for this offer", { status: 404 });

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
