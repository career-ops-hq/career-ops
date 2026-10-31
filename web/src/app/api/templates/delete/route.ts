import { NextResponse } from "next/server";
import { deleteTemplate } from "@/lib/template-files.mjs";
import { failure, manageContext, text } from "../manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete one of your own templates. A shipped template, and the one the profile
// names as the default, are refused.
export async function POST(req: Request) {
  const ctx = await manageContext(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    await deleteTemplate(ctx.codeRoot, { kind: ctx.kind, name: text(ctx.body.name), userDir: ctx.userDir, profilePath: ctx.profilePath });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
