import { NextResponse } from "next/server";
import fs from "node:fs";
import { rootScript } from "@/lib/career-ops";
import { runCoreCli } from "@/lib/core-cli";
import { canonicalizeStatus } from "@/lib/core/states";
import { readJsonObject } from "@/lib/json-body";
import { parseCliJson } from "@/lib/status-cli.mjs";
import { postingUrl } from "@/lib/posting-url.mjs";
import { acquireTrackerWrite, releaseTrackerWrite, isTrackerWriting } from "@/lib/core/run-registry";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJsonObject<{ url?: unknown; status?: unknown }>(req);
  const url = postingUrl(body?.url);
  const status = typeof body?.status === "string" ? canonicalizeStatus(body.status) : null;
  if (!url || !status || status === "Evaluated") return NextResponse.json({ error: "Choose a job and an application status. Score the job first to mark it Evaluated." }, { status: 400 });
  if (!fs.existsSync(rootScript("move-inbox"))) return NextResponse.json({ error: "Inbox status changes need the core move helper." }, { status: 503 });
  if (isTrackerWriting()) return NextResponse.json({ error: "A worker is updating the tracker. Try again once it finishes." }, { status: 409 });
  const token = acquireTrackerWrite();
  try {
    const result = await runCoreCli("move-inbox", [url, status, "--json"]);
    const saved = parseCliJson(result.stdout);
    if (result.timedOut) return NextResponse.json({ error: "The move timed out. Refresh the pipeline before retrying; the status may have been saved." }, { status: 504 });
    if (result.code !== 0 || saved?.ok !== true) return NextResponse.json({ error: typeof saved?.error === "string" ? saved.error : "Could not move this job. Please refresh and try again." }, { status: 409 });
    return NextResponse.json(saved);
  } finally {
    releaseTrackerWrite(token);
  }
}
