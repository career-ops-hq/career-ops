import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { readDocumentLibrary } from "@/lib/document-library";
import { buildResumeUpdatePreview } from "@/lib/resume-profile-updates.mjs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["family", "identifier"].includes(key))) throw new Error("Invalid update-preview request.");
    if (typeof body.family !== "string" || typeof body.identifier !== "string" || !/^[a-z0-9-]+$/i.test(body.identifier)) throw new Error("Invalid resume selection.");
    const library = readDocumentLibrary();
    return NextResponse.json(buildResumeUpdatePreview({ root: careerOpsRoot(), family: body.family, identifier: body.identifier, applications: library.applications, roles: library.roleResumes, profileState: library.profileState }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview resume updates." }, { status: 400 });
  }
}
