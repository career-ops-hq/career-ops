import { NextResponse } from "next/server";
import fs from "node:fs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { profileWithTemplate } from "@/lib/template-gallery.mjs";
import { renameTemplateAndFollow } from "@/lib/template-files.mjs";
import { failure, manageContext, text } from "../manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rename one of your own templates. When it was the default, the profile's
// template key follows it, so the rename does not silently send CVs back to the
// base template.
export async function POST(req: Request) {
  const ctx = await manageContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const name = text(ctx.body.name);
  const to = text(ctx.body.to);
  try {
    const { wasDefault } = await renameTemplateAndFollow(ctx.codeRoot, { kind: ctx.kind, name, to, userDir: ctx.userDir, profilePath: ctx.profilePath }, () => {
      atomicWriteWithBackup(ctx.profilePath, profileWithTemplate(fs.readFileSync(ctx.profilePath, "utf8"), ctx.kind, to));
    });
    return NextResponse.json({ ok: true, name: to, wasDefault });
  } catch (e) {
    return failure(e);
  }
}
