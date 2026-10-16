import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { digitArg, postCoreScript } from "@/lib/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flip the tracker PDF cell through mark-pdf-ready.mjs. The argument is the
// report number, not the tracker row number.
export async function POST(req: Request) {
  const body = await readJsonObject<{ report?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const report = digitArg(body.report);
  if (!report) {
    return NextResponse.json({ error: "report must be a report number" }, { status: 400 });
  }
  return postCoreScript({
    script: "mark-pdf-ready",
    args: [report, "--json"],
    logLabel: "api/pdf-ready",
    fallback: "could not mark the PDF ready",
  });
}
