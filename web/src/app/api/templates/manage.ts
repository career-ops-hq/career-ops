import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { readJsonObject } from "@/lib/json-body";
import { parseKind, userTemplatesDir } from "@/lib/template-gallery.mjs";
import { TemplateRefusal } from "@/lib/template-refusal.mjs";

// What the three manage routes (duplicate, rename, delete) share: the body, the
// kind, and the three locations. The core scripts live in the engine checkout; the
// profile and the user's templates live in the data root.
export type ManageContext = {
  kind: "cv" | "cover";
  body: Record<string, unknown>;
  codeRoot: string;
  userDir: string;
  profilePath: string;
  dataRoot: string;
};

export async function manageContext(req: Request): Promise<ManageContext | NextResponse> {
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const kind = parseKind(body.kind ?? "cv");
  if (!kind) return NextResponse.json({ error: "kind must be cv or cover" }, { status: 400 });
  const dataRoot = careerOpsRoot();
  return {
    kind,
    body,
    codeRoot: resolveCodeRoot(process.cwd(), process.env),
    userDir: userTemplatesDir(dataRoot),
    profilePath: getProfilePath(dataRoot),
    dataRoot,
  };
}

/** A name a request carries, or "" when it is missing or not text. */
export const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * A typed refusal is the caller's to fix and carries its own status. Anything else
 * is ours: it is logged here and answered generically, because a filesystem error's
 * message carries an absolute local path.
 */
export function failure(e: unknown): NextResponse {
  if (e instanceof TemplateRefusal) {
    // The refusal's own message is safe to return; what caused it may not be.
    if (e.cause) console.error("[templates]", e.cause);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[templates]", e);
  return NextResponse.json({ error: "Could not complete that." }, { status: 500 });
}
