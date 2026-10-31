import { NextResponse } from "next/server";
import fs from "node:fs";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { readJsonObject } from "@/lib/json-body";
import { assertSelectableTemplate, profileWithCvTemplate } from "@/lib/template-gallery.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Make a template the default for new CVs by writing cv.template in
// config/profile.yml, the key the CLI reads. Only that line changes.
export async function POST(req: Request) {
  const body = await readJsonObject<{ name?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name : "";

  // The core scripts live in the engine checkout; the profile lives in the data root.
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  const root = careerOpsRoot();
  try {
    await assertSelectableTemplate(codeRoot, name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown template" }, { status: 422 });
  }

  const file = getProfilePath(root);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "There is no config/profile.yml yet. Finish setup first, then choose a template." }, { status: 409 });
    }
    return NextResponse.json({ error: "config/profile.yml could not be read." }, { status: 500 });
  }
  try {
    atomicWriteWithBackup(file, profileWithCvTemplate(source, name));
  } catch (e) {
    // A profile that does not parse, or is not a mapping, is the user's to fix.
    return NextResponse.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, defaultName: name });
}
