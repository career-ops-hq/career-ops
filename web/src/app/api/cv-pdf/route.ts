import { NextRequest } from "next/server";
import fs from "node:fs";
import { cvPdfDisposition } from "@/lib/content-disposition.mjs";
import { locateTailoredPdf } from "@/lib/cv-pdf-file";
import { cvPdfSelectors } from "@/lib/cv-pdf-query.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function servePdf(file: string, downloadFlag: string | null): Response {
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": cvPdfDisposition(file, downloadFlag),
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const located = await locateTailoredPdf(cvPdfSelectors(req.nextUrl.searchParams));
  if (!("file" in located)) return new Response(located.message, { status: located.status });
  try {
    return servePdf(located.file, req.nextUrl.searchParams.get("download"));
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
