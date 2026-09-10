import { openSession } from "@/lib/apply/session";
import { blockedApplyUrlResponse, isUnsafeApplyUrlError, APPLY_URL_BLOCKED_MESSAGE } from "@/lib/apply/url-guard.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the agentic drive + interpretation fallbacks spawn a planner

// Open a persistent apply session: headed-but-off-screen Chrome opens the real
// form, we extract + tag its fields. The session stays open for fill + handoff.
// cliId enables the agentic fallback (the AI interprets the live form) when
// deterministic extraction is low-confidence.
export async function POST(req: Request) {
  let body: { url?: string; cliId?: string; agent?: boolean; _noApplyBtn?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  const blocked = await blockedApplyUrlResponse(url);
  if (blocked) return Response.json({ error: blocked.error }, { status: blocked.status });
  try {
    const session = await openSession(url, body.cliId, body.agent, body._noApplyBtn);
    return Response.json(session);
  } catch (e) {
    if (isUnsafeApplyUrlError(e)) {
      return Response.json({ error: APPLY_URL_BLOCKED_MESSAGE }, { status: 400 });
    }
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "could not open the form" }, { status: 500 });
  }
}
