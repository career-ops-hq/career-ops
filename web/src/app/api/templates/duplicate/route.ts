import { NextResponse } from "next/server";
import { duplicateTemplate } from "@/lib/template-files.mjs";
import { failure, manageContext, text } from "../manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Copy a template, shipped or yours, into your own templates directory under a new name.
export async function POST(req: Request) {
  const ctx = await manageContext(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({ ok: true, ...(await duplicateTemplate(ctx.codeRoot, { kind: ctx.kind, from: text(ctx.body.from), name: text(ctx.body.name), userDir: ctx.userDir })) });
  } catch (e) {
    return failure(e);
  }
}
