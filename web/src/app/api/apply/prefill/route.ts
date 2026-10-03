import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { getSession } from "@/lib/apply/session";
import { resolveSessionCv } from "@/lib/apply/cv";
import { applyCvSource } from "@/lib/apply/cv-source.mjs";
import { buildAnswerPrompt } from "@/lib/apply/answer-prompt.mjs";
import { runPlanner } from "@/lib/apply/planner";
import { extractJsonObject } from "@/lib/extract-json-object.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

// AI pre-fill (STREAMING NDJSON). The user's BYO CLI (read-only PLANNER — no
// browser access) drafts an answer per field from cv.md / profile / the job's
// report. We stream a live diagnostic log of every step (spawn, heartbeats,
// exit code/signal, parse outcome) so a stuck/empty prefill is observable on the
// page AND written to <root>/.career-ops-web/apply-prefill.log for debugging.
export async function POST(req: Request) {
  let body: { sessionId?: string; cliId?: string; company?: string; application?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { sessionId, cliId, company, application } = body;
  // Same two identifiers the fill route takes, validated the same way: they
  // reach a filesystem resolver, so a non-string is refused before it gets there.
  if (company !== undefined && typeof company !== "string") {
    return Response.json({ error: "company must be a string" }, { status: 400 });
  }
  if (application !== undefined && typeof application !== "string") {
    return Response.json({ error: "application must be a string" }, { status: 400 });
  }
  const t0 = Date.now();
  const encoder = new TextEncoder();
  const logPath = path.join(careerOpsRoot(), ".career-ops-web", "apply-prefill.log");
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    /* ignore */
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client gone */
        }
      };
      const log = (m: string) => {
        const el = Date.now() - t0;
        emit({ t: "log", m, el });
        try {
          fs.appendFileSync(logPath, `${new Date(t0 + el).toISOString()} [+${(el / 1000).toFixed(1)}s] ${m}\n`);
        } catch {
          /* ignore */
        }
      };
      // Idempotent, like the `closed` guard the sibling routes carry. fail() closes
      // the controller, and there is more than one path to it: a fencing refusal
      // reports through fail() and then resolves with an empty buffer, which the
      // empty-output branch below reports through fail() a second time. Closing an
      // already-closed controller throws "Invalid state", and that throw escapes
      // the async start() as an unhandled rejection — a worse failure than the one
      // being reported.
      let failed = false;
      const fail = (m: string, raw?: string) => {
        if (failed) return;
        failed = true;
        log(`ERROR: ${m}`);
        emit({ t: "error", m, raw });
        controller.close();
      };
      try {
        fs.appendFileSync(logPath, `\n===== prefill ${new Date(t0).toISOString()} session=${sessionId} cli=${cliId} =====\n`);
      } catch {
        /* ignore */
      }

      const s = sessionId ? getSession(sessionId) : undefined;
      if (!s) return fail("apply session not found (it may have expired)");
      const resolved = cliId ? resolveCli(cliId) : null;
      if (!resolved) return fail(`CLI '${cliId}' not found on this machine`);
      const { spec, binPath } = resolved;

      const mem = readMemory().trim();
      // Draft from the SAME tailored CV the fill route uploads to this form,
      // resolved through the one shared call so the answers and the resume
      // stapled to them cannot describe different documents.
      const cvPath = await resolveSessionCv({ company, application, title: s.title });
      const cvSource = cvPath ? applyCvSource(careerOpsRoot(), cvPath) : null;
      const prompt = buildAnswerPrompt({ title: s.title, fields: s.fields, memory: mem, cvSource });

      log(`Form: "${s.title}" · ${s.fields.length} fields · prompt ${prompt.length} chars · memory ${mem.length} chars`);
      log(`CV source: ${cvSource ?? "none found — answers will come from cv.md"}`);
      log(`Planner: ${cliId} (${binPath})`);
      const result = await runPlanner({
        cliId,
        spec,
        binPath,
        prompt,
        fieldCount: s.fields.length,
        cwd: careerOpsRoot(),
        t0,
        log,
      });

      // Fencing refused to start the planner (#2507): runPlanner already logged
      // the reason; report it as THE error, before the empty-output branch below
      // turns it into an unrelated "produced no output".
      if (result.refused) return fail(result.refused);

      log(`Planner exited code=${result.code} signal=${result.signal} · ${result.buf.length} chars total`);
      log(`output head: ${result.buf.slice(0, 100).replace(/\s+/g, " ") || "(empty)"}`);
      log(`output tail: ${result.buf.slice(-100).replace(/\s+/g, " ") || "(empty)"}`);

      if (!result.buf.trim()) {
        return fail(result.signal ? "planner was killed before producing any output (try again / smaller form)" : "planner produced no output (check the CLI works in this folder)");
      }

      const { obj, truncated } = extractJsonObject(result.buf);
      if (!obj) {
        return fail(
          result.signal ? "planner was killed mid-answer (form too large/slow) — couldn't recover any fields" : "couldn't parse the planner's answer as JSON",
          result.buf.slice(-300),
        );
      }
      const count = Object.keys(obj).length;
      log(`Parsed ${count} answers${truncated ? " (RECOVERED from truncated output — some fields may be missing)" : ""}`);
      emit({ t: "done", answers: obj, truncated, count });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
