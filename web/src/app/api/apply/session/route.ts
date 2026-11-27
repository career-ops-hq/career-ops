import { openSession } from "@/lib/apply/session";
import { resolveSessionCv } from "@/lib/apply/cv";
import { cliSubstitutionNotice, resolveCliOrFallback } from "@/lib/clis";
import { blockedApplyUrlResponse, isUnsafeApplyUrlError, APPLY_URL_BLOCKED_MESSAGE } from "@/lib/apply/url-guard.mjs";
import { unsupportedInAppAts, unsupportedSessionJson } from "@/lib/apply/unsupported-ats.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the agentic drive + interpretation fallbacks spawn a planner

// Open a persistent apply session: headed-but-off-screen Chrome opens the real
// form, we extract + tag its fields. The session stays open for fill + handoff.
// cliId enables the agentic fallback (the AI interprets the live form) when
// deterministic extraction is low-confidence.
export async function POST(req: Request) {
  const body = await readJsonObject<{ url?: string; cliId?: string; agent?: boolean; _noApplyBtn?: boolean; n?: string | number; company?: string }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const url = (body.url ?? "").trim();
  const blocked = await blockedApplyUrlResponse(url);
  if (blocked) return Response.json({ error: blocked.error }, { status: blocked.status });
  // A stale saved id falls back to the sole installed CLI, as on every other AI
  // route (#4607). Unresolvable → pass it through unchanged: the interpreter
  // already treats a missing CLI as "no agentic fallback".
  const resolved = body.cliId ? resolveCliOrFallback(body.cliId) : null;
  const cliId = resolved?.spec.id ?? body.cliId;
  const substitution = resolved ? cliSubstitutionNotice(resolved) : null;
  try {
    const refused = await unsupportedInAppAts(url);
    if (refused) return Response.json(unsupportedSessionJson(refused, body.n));
    const session = await openSession(url, cliId, body.agent, body._noApplyBtn);
    if ("unsupported" in session) return Response.json(unsupportedSessionJson(session.unsupported, body.n, true));
    if (substitution) session.issues.push({ level: "info", code: "cli-substituted", message: substitution });
    const application = body.n != null && String(body.n).trim() ? String(body.n) : undefined;
    const company = typeof body.company === "string" ? body.company : undefined;
    let cvAttached = false;
    try {
      cvAttached = !!(await resolveSessionCv({ company, application, title: session.title }));
    } catch {
      // A PDF index failure must not stop the form from opening.
      cvAttached = false;
    }
    return Response.json({ ...session, cvAttached });
  } catch (e) {
    if (isUnsafeApplyUrlError(e)) {
      return Response.json({ error: APPLY_URL_BLOCKED_MESSAGE }, { status: 400 });
    }
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "could not open the form" }, { status: 500 });
  }
}
