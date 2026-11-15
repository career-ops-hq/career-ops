import { fillSession, handoffSession, getSession } from "@/lib/apply/session";
import { resolveSessionCv, uploadNameForCv } from "@/lib/apply/cv";
import { handoffDecision } from "@/lib/apply/handoff-gate.mjs";
import type { ApplyField } from "@/lib/apply/extract";
import type { ApplyIssue } from "@/lib/apply/issue";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Fill the real form behind the scenes (headed-but-off-screen), screenshotting
// each step for the "behind the scenes" strip, then bring the window to the front
// so the HUMAN reviews and submits. NEVER submits — there is no submit path here.
export async function POST(req: Request) {
  const body = await readJsonObject<{ sessionId?: string; answers?: Record<string, string>; fields?: ApplyField[]; handoff?: boolean; company?: string; application?: string }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const { sessionId, answers = {}, fields = [], handoff, company, application } = body;
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  if (company !== undefined && typeof company !== "string") {
    return Response.json({ error: "company must be a string" }, { status: 400 });
  }
  if (application !== undefined && typeof application !== "string") {
    return Response.json({ error: "application must be a string" }, { status: 400 });
  }

  // Resolve the tailored CV server-side (never trust a client path): by the
  // offer's company if known, else best-effort from the form title.
  const session = getSession(sessionId);
  const cvPath = (await resolveSessionCv({ company, application, title: session?.title })) ?? undefined;

  try {
    const cvUploadName = cvPath ? uploadNameForCv({ application, title: session?.title }) : undefined;
    const result = await fillSession(sessionId, answers, fields, cvPath, cvUploadName);
    const unmetLabels = (result.issues ?? []).flatMap((issue) =>
      issue.code === "required-empty" && Array.isArray(issue.labels) ? issue.labels : [],
    );
    const decision = handoffDecision({
      fields,
      answers,
      cvAttached: !!cvPath,
      steps: result.steps,
      unmetLabels,
    });
    const issues = [...(result.issues ?? [])];
    for (const gap of decision.gaps) {
      if (!issues.some((issue) => issue.message === gap.message)) issues.push(gap as ApplyIssue);
    }
    const handedOff = !!handoff && decision.handoff;
    if (handedOff) await handoffSession(sessionId).catch(() => {});
    return Response.json({ ...result, issues, handedOff, cvAttached: !!cvPath });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "fill failed" }, { status: 500 });
  }
}
