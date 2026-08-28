import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { AUTO_COVER_MARKER, autoCoverEnabled } from "@/lib/cover-letter-workflow.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

const OFF_MARKER = "<!-- co-web:auto-cover-letter: off -->";
const settingsPath = () => path.join(careerOpsRoot(), "modes", "_custom.md");

export async function GET() {
  let content = "";
  try { content = fs.readFileSync(settingsPath(), "utf8"); } catch { /* false below */ }
  return NextResponse.json({ autoCoverLetter: autoCoverEnabled(content) });
}

export async function POST(request: Request) {
  let body: { autoCoverLetter?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  if (typeof body.autoCoverLetter !== "boolean") return NextResponse.json({ error: "Boolean setting required" }, { status: 400 });
  try {
    const file = settingsPath();
    let content = fs.readFileSync(file, "utf8");
    const next = body.autoCoverLetter ? AUTO_COVER_MARKER : OFF_MARKER;
    if (content.includes(AUTO_COVER_MARKER)) content = content.replace(AUTO_COVER_MARKER, next);
    else if (content.includes(OFF_MARKER)) content = content.replace(OFF_MARKER, next);
    else content += `\n${next}\n`;
    atomicWriteWithBackup(file, content);
    return NextResponse.json({ ok: true, autoCoverLetter: body.autoCoverLetter });
  } catch { return NextResponse.json({ error: "Could not save setting" }, { status: 500 }); }
}
