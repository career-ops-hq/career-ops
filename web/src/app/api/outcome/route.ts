import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { isTrackerWriting } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Records an application outcome by orchestrating the core `outcome.mjs`
// script (archives the submitted CV/cover/posting under data/outcomes/ and
// syncs the tracker status via set-status.mjs's locked, validated write path)
// — never hand-writes applications.md, same discipline as /api/status and
// tracker/delete. Deterministic script, not an agent job: no LLM involved.

const VALID_TYPES = new Set([
  "interview_progress",
  "offer_received",
  "hired",
  "offer_declined",
  "rejected",
  "no_response",
  "interview_only",
]);

let recording = false;

export async function POST(req: Request) {
  let body: { n?: string | number; outcomeType?: string; stage?: string; feedback?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const n = String(body.n ?? "").trim();
  const outcomeType = String(body.outcomeType ?? "").trim();
  if (!n) {
    return Response.json({ error: "n (tracker # or company) required" }, { status: 400 });
  }
  if (!VALID_TYPES.has(outcomeType)) {
    return Response.json({ error: `invalid outcomeType — expected one of: ${[...VALID_TYPES].join(", ")}` }, { status: 400 });
  }

  // Serialize against an in-flight evaluate/pdf run's merge-tracker step, same
  // guard as tracker/delete — outcome.mjs's own set-status.mjs call is locked,
  // but a concurrent merge-tracker append could still race the row it reads.
  if (isTrackerWriting()) {
    return Response.json(
      { error: "An evaluation is updating your tracker right now — try again in a moment." },
      { status: 409 },
    );
  }
  if (recording) {
    return Response.json({ error: "Another outcome is already being recorded — try again in a moment." }, { status: 409 });
  }
  recording = true;

  const args = [rootScript("outcome"), n, outcomeType, "--json"];
  if (body.stage?.trim()) args.push("--stage", body.stage.trim());
  if (body.feedback?.trim()) args.push("--feedback", body.feedback.trim());
  if (body.note?.trim()) args.push("--note", body.note.trim());

  try {
    const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      let out = "";
      let err = "";
      let child;
      try {
        child = spawn(process.execPath, args, { cwd: careerOpsRoot(), env: process.env });
      } catch (e) {
        resolve({ code: 1, out: "", err: e instanceof Error ? e.message : "failed to start outcome.mjs" });
        return;
      }
      child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
      const killer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, 60_000);
      child.on("error", (e) => { clearTimeout(killer); resolve({ code: 1, out, err: e.message }); });
      child.on("close", (code) => { clearTimeout(killer); resolve({ code, out, err }); });
    });

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(result.out.trim());
    } catch {
      /* fall through to raw error */
    }

    if (result.code !== 0 || !parsed?.success) {
      const msg = (parsed?.error as string | undefined) || result.err.trim().split("\n")[0] || "outcome recording failed";
      const notFound = /not found|No tracker row/i.test(msg);
      const ambiguous = /Multiple tracker rows/i.test(msg);
      return Response.json({ error: msg }, { status: ambiguous ? 409 : notFound ? 404 : 400 });
    }

    return Response.json(parsed);
  } finally {
    recording = false;
  }
}
