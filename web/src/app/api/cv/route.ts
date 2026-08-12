import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { listCvVersions, saveCvVersion } from "@/lib/cv-version-store.mjs";

function cvPath() {
  return path.join(careerOpsRoot(), "cv.md");
}

const MAX_CV_BYTES = 10 * 1024 * 1024;

export async function GET() {
  const versions = await listCvVersions(careerOpsRoot());
  try {
    return NextResponse.json({ content: fs.readFileSync(cvPath(), "utf8"), exists: true, versions });
  } catch {
    return NextResponse.json({ content: "", exists: false, versions });
  }
}

export async function POST(req: Request) {
  let body: { content?: string; label?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_CV_BYTES) {
    return NextResponse.json({ error: "CV-filen får vara högst 10 MB" }, { status: 413 });
  }
  try {
    const version = await saveCvVersion(careerOpsRoot(), {
      content: body.content,
      label: body.label || "Manuell CV-redigering",
      source: body.source || "editor",
    });
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "write failed" },
      { status: 500 },
    );
  }
}
