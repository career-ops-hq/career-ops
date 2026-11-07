import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { listCvTemplates } from "@/lib/template-gallery.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The CV templates the core resolves, and which one the profile makes the
// default. Listing is the core's (cv-templates.mjs); this route adds nothing to it.
export async function GET() {
  // The core scripts live in the engine checkout; the profile lives in the data root.
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  const root = careerOpsRoot();
  try {
    return NextResponse.json(await listCvTemplates(codeRoot, { profilePath: getProfilePath(root) }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not list templates" }, { status: 500 });
  }
}
