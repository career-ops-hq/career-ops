import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { keywordsInText, loadStudio, renderEditedPdf, saveEdits } from "@/lib/cv-studio/server";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";
import { parseEdits } from "@/lib/cv-studio/studio.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ n: string }> };

const NOT_FOUND = { "no-report": 404, "no-tailored-cv": 404, "unreadable-layout": 422 } as const;

const saving = new Set<string>();

export async function GET(_req: Request, { params }: RouteContext) {
  const load = await loadStudio((await params).n);
  if (!load.ok) return NextResponse.json({ error: load.reason }, { status: NOT_FOUND[load.reason] });
  return NextResponse.json(load);
}

// Autosave. The edits are re-parsed against the current tailored HTML, so a
// tab left open across a regeneration cannot write edits for the old CV.
export async function PUT(req: Request, { params }: RouteContext) {
  const body = await readJsonObject<{ edits?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const load = await loadStudio((await params).n);
  if (!load.ok) return NextResponse.json({ error: load.reason }, { status: NOT_FOUND[load.reason] });
  const parsed = parseEdits(body.edits, load.doc.sourceHash);
  if (!parsed) return NextResponse.json({ error: "edits required" }, { status: 400 });
  if (parsed.stale) return NextResponse.json({ error: "stale" }, { status: 409 });
  saveEdits(load.reportNum, parsed.edits);
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: RouteContext) {
  const n = (await params).n;
  const body = await readJsonObject<{ op?: string; edits?: unknown; text?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  if (body.op === "keywords") {
    if (typeof body.text !== "string" || body.text.length > 2000) return NextResponse.json({ error: "text required" }, { status: 400 });
    const keywords = await keywordsInText(n, body.text);
    return keywords ? NextResponse.json({ keywords }) : NextResponse.json({ error: "no-report" }, { status: 404 });
  }
  if (body.op !== "save") return NextResponse.json({ error: "unknown op" }, { status: 400 });
  const load = await loadStudio(n);
  if (!load.ok) return NextResponse.json({ error: load.reason }, { status: NOT_FOUND[load.reason] });
  const parsed = parseEdits(body.edits, load.doc.sourceHash);
  if (!parsed) return NextResponse.json({ error: "edits required" }, { status: 400 });
  if (parsed.stale) return NextResponse.json({ error: "stale" }, { status: 409 });
  if (saving.has(load.reportNum)) return NextResponse.json({ error: "busy" }, { status: 409 });
  saving.add(load.reportNum);
  const token = acquireTrackerWrite();
  try {
    saveEdits(load.reportNum, parsed.edits);
    const result = await renderEditedPdf(load, parsed.edits);
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error.slice(0, 600) }, { status: 422 });
  } finally {
    saving.delete(load.reportNum);
    releaseTrackerWrite(token);
  }
}
