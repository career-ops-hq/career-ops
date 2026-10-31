import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { listTemplatesOfKind, parseKind } from "@/lib/template-gallery.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The templates of one kind (cv, the default, or cover) the core resolves, and which one the profile makes the
// default. Listing is the core's (cv-templates.mjs); this route adds nothing to it.
export async function GET(req: Request) {
  const kind = parseKind(new URL(req.url).searchParams.get("kind") ?? "cv");
  if (!kind) return NextResponse.json({ error: "kind must be cv or cover" }, { status: 400 });
  // The core scripts live in the engine checkout; the profile lives in the data root.
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  const root = careerOpsRoot();
  try {
    return NextResponse.json(await listTemplatesOfKind(codeRoot, kind, { profilePath: getProfilePath(root) }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "could not list templates" }, { status: 500 });
  }
}
