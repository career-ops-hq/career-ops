import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { applicantName } from "@/lib/document-library";
import { generateReadyFilename, resolveExistingDocument } from "@/lib/documents.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { path?: unknown; company?: unknown; kind?: unknown; replace?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  if (typeof body.path !== "string" || typeof body.company !== "string" || !["resume", "cover-letter"].includes(String(body.kind))) {
    return NextResponse.json({ error: "Invalid copy request" }, { status: 400 });
  }
  const source = resolveExistingDocument(careerOpsRoot(), body.path, true);
  if (!source) return NextResponse.json({ error: "Source document not found" }, { status: 404 });
  const filename = generateReadyFilename(body.company, applicantName(), body.kind);
  const readyDir = path.join(careerOpsRoot(), "ready-to-apply");
  fs.mkdirSync(readyDir, { recursive: true });
  const destination = path.join(readyDir, filename);
  const exists = fs.existsSync(destination);
  if (exists && body.replace !== true) return NextResponse.json({ error: "Destination exists", filename }, { status: 409 });
  if (exists) {
    const stat = fs.lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) return NextResponse.json({ error: "Unsafe destination" }, { status: 409 });
  }
  try {
    fs.copyFileSync(source, destination, body.replace === true ? 0 : fs.constants.COPYFILE_EXCL);
    return NextResponse.json({ ok: true, filename });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return NextResponse.json({ error: "Destination exists", filename }, { status: 409 });
    return NextResponse.json({ error: "Copy failed" }, { status: 500 });
  }
}
