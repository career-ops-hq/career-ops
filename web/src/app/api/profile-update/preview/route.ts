import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { buildProfileUpdatePreview, listWorkExperience } from "@/lib/profile-updates.mjs";

export async function GET() {
  try {
    const cv = fs.readFileSync(path.join(careerOpsRoot(), "cv.md"), "utf8");
    return NextResponse.json({ workEntries: listWorkExperience(cv).map(({ index, label }) => ({ index, label })) });
  } catch { return NextResponse.json({ workEntries: [] }); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const cv = fs.readFileSync(path.join(careerOpsRoot(), "cv.md"), "utf8");
    const result = buildProfileUpdatePreview(cv, body);
    return NextResponse.json({ preview: result.preview, duplicate: result.duplicate, warning: result.warning, previewHash: result.previewHash, workEntries: result.workEntries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview profile update." }, { status: 400 });
  }
}
