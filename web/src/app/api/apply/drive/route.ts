import { getSession, finalizeDrivenSession, extractCurrent, isApplicationFormFn, handoffSession, fillSession } from "@/lib/apply/session";
import { driveSession } from "@/lib/apply/drive";
import { classifyEmpty, verifyFill } from "@/lib/apply/diagnose";
import { resolveSessionCv, uploadNameForCv } from "@/lib/apply/cv";
import { answersForRefreshedFields, handoffDecision } from "@/lib/apply/handoff-gate.mjs";
import { readbackIssues } from "@/lib/apply/prefilled-banner.mjs";
import { resolveCliOrFallback } from "@/lib/clis";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Streamed agentic drive over an OPEN session: the AI drives the headed page to
// REACH a fillable application form (the user watches each step live), then we
// extract + finalize. NEVER submits (enforced in driveSession).
export async function POST(req: Request) {
  const body = await readJsonObject<{ sessionId?: string; cliId?: string; goal?: "reach" | "full"; answers?: { id?: string; label: string; value: string }[]; company?: string; application?: string }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const { sessionId, goal = "reach", answers } = body;
  // Same fallback as the session open that precedes every drive, which is where
  // a substitution is reported (#4607); driveSession() itself needs Claude.
  const cliId = (body.cliId && resolveCliOrFallback(body.cliId)?.spec.id) || body.cliId || "";
  const s = sessionId ? getSession(sessionId) : undefined;
  if (!s) return Response.json({ error: "apply session not found (it may have expired)" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* client gone */
        }
      };
      try {
        const page = s.page;
        const isFormReady = async () => {
          try {
            return isApplicationFormFn((await extractCurrent(page, s.url)).form);
          } catch {
            return false;
          }
        };
        const budget = goal === "full" ? 16 : 7;
        const result = await driveSession(page, cliId, goal, isFormReady, (step) => emit({ t: "step", ...step }), budget, answers);

        if (goal === "full") {
          // Open the window only when required screening answers have values and a claimed résumé file landed.
          if (!result.reached) {
            emit({ t: "done", filled: false, turns: result.turns, reason: result.reason });
            return;
          }
          const company = typeof body.company === "string" ? body.company : undefined;
          const application = typeof body.application === "string" ? body.application : undefined;
          // A throw here used to skip the gate and return t:error. The résumé is
          // unattached, the gate still decides, and the message rides the same
          // done stream as the other gaps.
          let cvPath: string | null = null;
          let cvResolveError = "";
          try {
            cvPath = await resolveSessionCv({ company, application, title: s.title });
          } catch (error) {
            cvPath = null;
            cvResolveError = error instanceof Error ? error.message.slice(0, 160) : "Could not resolve the résumé.";
          }
          // Snapshot first. Finalizing replaces s.fields and reassigns positional ids.
          const beforeFields = Array.isArray(s.fields) ? s.fields.slice() : [];
          const fin = await finalizeDrivenSession(s.id, cliId);
          if (!fin) {
            const unread = { level: "warn" as const, code: "fill-unverified", message: "Couldn't read the form back, so it is not counted as pre-filled." };
            emit({
              t: "done",
              filled: false,
              turns: result.turns,
              reason: result.reason,
              gaps: cvResolveError
                ? [{ level: "warn" as const, code: "cv-resolve", message: cvResolveError }, unread]
                : [unread],
            });
            return;
          }
          const cvUploadName = cvPath ? uploadNameForCv({ application, title: s.title }) : undefined;
          const refreshed = answersForRefreshedFields(beforeFields, s.fields, body.answers);
          const supplied = refreshed.answers;
          // The agent already typed these answers. An empty fill map attaches
          // the résumé only. `supplied` is what read-back compares.
          const attached = cvPath
            ? await fillSession(s.id, {}, s.fields, cvPath, cvUploadName, supplied)
            : { steps: [], issues: await verifyFill(s.frame, s.fields, supplied) };
          const unmetLabels = (attached.issues ?? []).flatMap((issue) =>
            issue.code === "required-empty" && Array.isArray(issue.labels) ? issue.labels : [],
          );
          const decision = handoffDecision({
            fields: s.fields,
            answers: supplied,
            cvAttached: !!cvPath,
            steps: attached.steps,
            unmetLabels,
          });
          if (decision.handoff) await handoffSession(s.id).catch(() => {});
          const readback = readbackIssues(attached.issues);
          const dropped = Array.isArray(refreshed.dropped) ? refreshed.dropped : [];
          const unmatched = dropped.length
            ? [{
              level: "warn" as const,
              code: "fill-unverified",
              message: `Couldn't match these answers to the form, so they are not counted as pre-filled: ${dropped.join(", ")}.`,
            }]
            : [];
          const gaps = [
            ...(cvResolveError ? [{ level: "warn" as const, code: "cv-resolve", message: cvResolveError }] : []),
            ...(Array.isArray(fin.issues) ? fin.issues : []),
            ...decision.gaps,
            ...readback,
            ...unmatched,
          ];
          emit({
            t: "done",
            filled: decision.handoff,
            turns: result.turns,
            reason: result.reason,
            gaps,
          });
          return;
        }

        if (result.reached) {
          const fin = await finalizeDrivenSession(s.id, cliId);
          if (fin) {
            emit({ t: "done", reached: true, turns: result.turns, title: fin.title, fields: fin.fields, issues: fin.issues });
            return;
          }
        }
        // Didn't reach a real form → classify why for a clear message.
        const why = await classifyEmpty(page, s.url).catch(() => ({ message: "Couldn't reach a fillable form on this page." }));
        emit({ t: "error", reason: result.reason, message: result.reason === "stuck" ? result.steps.at(-1)?.detail || why.message : why.message });
      } catch (e) {
        emit({ t: "error", message: e instanceof Error ? e.message.slice(0, 160) : "drive failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
