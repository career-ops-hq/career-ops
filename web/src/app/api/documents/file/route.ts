import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveExistingDocument } from "@/lib/documents.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("path") ?? "";
  const file = resolveExistingDocument(careerOpsRoot(), relativePath);
  if (!file) return new Response("Document not found", { status: 404 });
  try {
    const filename = path.basename(file).replace(/["\r\n]/g, "_");
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(fs.readFileSync(file)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Could not read document", { status: 500 });
  }
}
