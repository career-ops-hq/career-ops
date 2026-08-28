import { NextResponse } from "next/server";
import { readApplications, readReport } from "@/lib/career-ops";
import { findManualJobDuplicate, normalizeManualJobInput } from "@/lib/manual-jobs.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  try {
    const job = normalizeManualJobInput(body);
    const applications = readApplications();
    const duplicate = findManualJobDuplicate(job, applications, (app: { n: string }) => readReport(app.n)?.content || "");
    return NextResponse.json({ job, duplicate });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid manual job input." }, { status: 400 });
  }
}
