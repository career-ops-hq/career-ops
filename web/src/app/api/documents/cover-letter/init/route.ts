import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { autoCoverEnabled, initializeCoverLetterDraft } from "@/lib/cover-letter-workflow.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { applicationId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const applicationId = String(body.applicationId ?? "").trim();
  if (!/^\d+$/.test(applicationId)) return NextResponse.json({ error: "Invalid application ID" }, { status: 400 });
  let custom = "";
  try { custom = fs.readFileSync(path.join(careerOpsRoot(), "modes", "_custom.md"), "utf8"); } catch { /* disabled without local opt-in */ }
  try {
    return NextResponse.json(initializeCoverLetterDraft(careerOpsRoot(), applicationId, autoCoverEnabled(custom)));
  } catch {
    return NextResponse.json({ error: "Could not initialize cover-letter review" }, { status: 500 });
  }
}
