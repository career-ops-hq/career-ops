import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCv } from "@/lib/apply/cv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the exact tailored CV for a tracker application when its number is
// provided. Company-only lookup remains for manually opened URLs.
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const application = req.nextUrl.searchParams.get("application") ?? undefined;
  if (!company && !application) return new Response("company or application required", { status: 400 });
  const file = resolveTailoredCv(company, application);
  if (!file) return new Response("no tailored CV found for this offer", { status: 404 });
  try {
    const buf = fs.readFileSync(file);
    const filename = path.basename(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
