import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { rootScript } from "@/lib/career-ops";
import { coreScriptHttp } from "@/lib/core-script-result.mjs";
import { readJsonObject } from "@/lib/json-body";
import { markTrackerReady } from "@/lib/pdf-render.mjs";
import { digitArg } from "@/lib/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK = "could not mark the PDF ready";

// Flip the tracker PDF cell the way a CV Studio render does, through
// markTrackerReady. The script lives in the code checkout, which can differ
// from the data root. The argument is the report number, not the tracker row number.
export async function POST(req: Request) {
  const body = await readJsonObject<{ report?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const report = digitArg(body.report);
  if (!report) {
    return NextResponse.json({ error: "report must be a report number" }, { status: 400 });
  }
  const mark = await markTrackerReady({ spawnFn: spawn, execPath: process.execPath, root: path.dirname(rootScript("mark-pdf-ready")), reportNum: report });
  if (!mark.ok && !mark.data) console.error(`/api/pdf-ready: ${mark.stderr}`);
  if (mark.code === null) return NextResponse.json({ error: FALLBACK }, { status: 500 });
  const mapped = coreScriptHttp({ code: mark.code, parsed: mark.data, fallback: FALLBACK });
  return NextResponse.json(mapped.body, { status: mapped.status });
}
