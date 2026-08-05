import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory, findReportFile } from "@/lib/career-ops";
import { resolvePdfPaths, type PdfPaths } from "@/lib/pdf-paths.mjs";
import { renderAndMarkPdf, writeCvHtml, pdfRunOutcome } from "@/lib/pdf-render.mjs";
import { createCvEnvelopeFilter, type CvEnvelope } from "@/lib/cv-envelope.mjs";
import { buildPrompt, isShellSafeCompanyName } from "@/lib/run-prompts.mjs";
import { claudeCliArgs } from "@/lib/claude-invocation.mjs";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

export async function POST(req: Request) {
  let body: { kind?: string; input?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { kind = "evaluate", input, cliId } = body;
  if (!input || !cliId) {
    return new Response(JSON.stringify({ error: "input and cliId required" }), { status: 400 });
  }
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return new Response(JSON.stringify({ error: `CLI '${cliId}' not found` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;

  // These run the REAL core (modes/scripts), not just data — fail clearly if the
  // root is incomplete instead of faking it.
  const needsScript: Record<string, string> = { evaluate: "modes/oferta.md", "fix-portal": "verify-portals.mjs", pdf: "generate-pdf.mjs" };
  const required = needsScript[kind];
  if (required && !fs.existsSync(path.join(careerOpsRoot(), required))) {
    return new Response(
      JSON.stringify({
        error: `This needs a complete career-ops checkout (${required}). CAREER_OPS_ROOT has data only — point it at a full checkout.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // fix-portal's prompt puts this straight into a shell command the agent runs, and
  // a company name can arrive from a public ATS listing rather than the user's own
  // typing. Refuse rather than sanitize: a silently rewritten name would repair the
  // wrong portal.
  if (kind === "fix-portal" && !isShellSafeCompanyName(input)) {
    return new Response(
      JSON.stringify({ error: "That company name has characters I can't safely pass to the portal checker — rename it in portals.yml first." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  if ((kind === "evaluate" || kind === "pdf") && !fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return new Response(
      JSON.stringify({ error: "Add your CV first so I can score this against you — drop it on the home page." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Precompute deterministic scratch + final paths so the agent never chooses
  // its own filenames — the backend owns naming, writing (#2185) and rendering
  // (#2172). Nothing is cleared first: writeCvHtml rewrites the HTML
  // from this run's freshly parsed envelope before any render, and the agent is
  // no longer told these paths, so a stale file cannot survive into a render.
  let pdfPaths: PdfPaths | undefined;
  if (kind === "pdf") {
    const pathsResult = resolvePdfPaths(input, today, careerOpsRoot(), findReportFile);
    if (!pathsResult.ok) {
      return new Response(JSON.stringify({ error: pathsResult.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    pdfPaths = pathsResult.paths;
  }

  const prompt = buildPrompt({ kind, input, memory: readMemory(), today });

  const isClaude = cliId === "claude";
  // Which tools each kind gets, and the whole claude argv, live in
  // claude-invocation.mjs — see its header for the policy and for why it is asserted on
  // built values rather than on this file's source. NEVER auto-submits; that
  // remains a prompt-level guarantee.
  // Non-Claude CLIs get no tool flags from spec.args() at all, so their agents
  // stay unrestricted here. That gap is route-wide (it applies to 'evaluate' too),
  // not specific to pdf, and each CLI needs its own mechanism researched — tracked
  // as #2507 rather than half-fixed here. On those CLIs the backend is the only
  // INTENDED writer — the agent is not asked to write — but that is mitigation, not
  // enforcement: the capability is still there for an injected posting to reach.
  const args = isClaude ? claudeCliArgs({ kind, prompt }) : spec.args(prompt);

  // For write-needing kinds, snapshot reports/ so we can verify the worker
  // actually persisted (non-Claude CLIs lack Write auth and silently no-op).
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const countReports = () => {
    try {
      return fs.readdirSync(reportsDir).filter((f) => f.endsWith(".md")).length;
    } catch {
      return 0;
    }
  };
  const persists = kind === "evaluate";
  const reportsBefore = persists ? countReports() : 0;
  // Tracker-mutating runs hold a write token so a row delete can't race their merge
  // (tracker.mjs delete doesn't yet share a lock with merge-tracker — see run-registry).
  const writeToken = kind === "evaluate" || kind === "pdf" ? acquireTrackerWrite() : null;

  const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env });
  // Decode once on the stream, not per chunk. Buffer#toString() decodes each chunk
  // independently, so a chunk boundary falling inside a multi-byte UTF-8 sequence
  // yields a replacement character and mis-decodes the bytes after it. Those bytes
  // are the CV now (#2185) — the agent's HTML flows through cvFilter to
  // writeCvHtml and on to the renderer — and no structural check would catch it,
  // because the envelope markers and </html> are ASCII and still match. Setting
  // the encoding makes Node hold partial sequences across chunks.
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const enc = new TextEncoder();

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before the child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  // pdf-kind's render+mark work (renderPdf, below) keeps running detached even
  // after the agent child closes — and even after a client disconnect fires
  // cancel(). Track its promise so cancel() can defer releasing writeToken
  // until that work actually settles, instead of releasing the tracker-delete
  // guard while mark-pdf-ready.mjs is still actively writing applications.md.
  let pdfRenderPromise: Promise<void> | null = null;
  let writeTokenReleased = false;
  const releaseWriteTokenOnce = () => {
    if (writeToken !== null && !writeTokenReleased) {
      writeTokenReleased = true;
      releaseTrackerWrite(writeToken);
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emittedText = false; // any assistant text delta → the CLI actually ran
      let sawError = false;
      let stderrBuf = "";
      // Widened over time: auth/login/quota failures are the most common real error
      // and a narrow regex missed them (silent false "success").
      const STDERR_FAILURE = /error|denied|fatal|not found|unauthorized|forbidden|auth|login|credential|api[ -]?key|quota|rate limit|not authenticated/i;
      const flagStderrLine = (line: string) => {
        if (!line.trim() || !STDERR_FAILURE.test(line)) return;
        sawError = true;
        send({ type: "error", msg: line.trim().slice(0, 200) });
      };
      let lastTokens = 0; // per-run token cost from the Claude result event (#6) — local only
      let lastCostUsd: number | null = null;
      // pdf-mode's agent only tailors content now (rendering moved to the
      // backend, #2172) — but its killMs still has to leave real headroom
      // inside the route's overall maxDuration (800s): the render+mark phase
      // (renderPdf, below) starts only after this timer's window and has no
      // timeout of its own, so an agent that runs close to its full budget
      // would otherwise leave the platform's hard maxDuration cutoff to kill
      // generate-pdf.mjs mid-render. 600s agent / ~200s render is ample —
      // a Chromium PDF render normally takes low tens of seconds even with a
      // cold Playwright launch.
      const killMs = kind === "pdf" ? 600_000 : 285_000;
      killer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, killMs);
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };
      const close = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
          releaseWriteTokenOnce();
          try { controller.close(); } catch { /* */ }
        }
      };
      // pdf's CV arrives inline in a <<cv-html>> envelope instead of being written
      // by the agent (#2185). The filter keeps every byte for the backend while
      // holding the 15-25 KB body out of the run log, which is the agent's
      // narration — see cv-envelope.mjs.
      const cvFilter = kind === "pdf" ? createCvEnvelopeFilter() : null;
      const sendAgentText = (text: string) => {
        const visible = cvFilter ? cvFilter.push(text) : text;
        if (visible) send({ type: "text", text: visible });
      };
      /** Surface non-fatal issues in the run log rather than only a server log. */
      const sendWarnings = (warnings: string[]) => {
        for (const w of warnings) send({ type: "text", text: `⚠️ ${w}\n` });
      };
      /** Persist the emitted CV; streams the reason and returns false on failure. */
      const saveCv = (paths: PdfPaths, envelope: CvEnvelope) => {
        const written = writeCvHtml({ pdfPaths: paths, html: envelope.html });
        if (!written.ok) send({ type: "error", msg: written.error.slice(0, 200) });
        return written.ok;
      };

      child.stdout.on("data", (chunk: string) => {
        if (closed) return;
        if (!isClaude) {
          emittedText = true;
          // MERGE HAZARD (#2102): once that PR parses non-Claude stdout as JSONL,
          // this must move onto the PARSED text or the envelope silently stops
          // being filtered and collected for codex. git reports no conflict.
          sendAgentText(chunk);
          return;
        }
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "stream_event") {
              const e = ev.event;
              if (e?.type === "content_block_start" && e.content_block?.type === "tool_use") {
                send({ type: "tool", name: e.content_block.name });
              } else if (e?.type === "content_block_delta" && e.delta?.text) {
                emittedText = true;
                sendAgentText(e.delta.text);
              }
            } else if (ev.type === "system" && ev.subtype === "init") {
              send({ type: "status", label: "Agent ready" });
            } else if (ev.type === "result") {
              // Capture the per-run cost; the authoritative "done" is sent on close
              // (so the honesty gate decides done-vs-error first). Tokens = the same
              // formula /api/usage uses: input + output + cache-creation.
              const u = ev.usage || {};
              lastTokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
              if (typeof ev.total_cost_usd === "number") lastCostUsd = ev.total_cost_usd;
            }
          } catch {
            /* partial line */
          }
        }
      });
      child.stderr.on("data", (chunk: string) => {
        // Match on COMPLETE lines. A chunk boundary can fall mid-word, so testing a
        // raw chunk both misses an error split across two of them and can match a
        // fragment that is not the word it looks like. sawError feeds pdfRunOutcome,
        // where a false positive fails a run whose PDF rendered fine, so the
        // boundary has to be settled before the regex sees it.
        stderrBuf += chunk;
        let nl;
        while ((nl = stderrBuf.indexOf("\n")) !== -1) {
          const line = stderrBuf.slice(0, nl);
          stderrBuf = stderrBuf.slice(nl + 1);
          flagStderrLine(line);
        }
      });
      // Render + mark-tracker-ready live in pdf-render.mjs (plain, dependency-
      // injected, unit-tested) so the render-then-mark orchestration isn't
      // buried untested inside this transport-layer closure. Runs generate-
      // pdf.mjs and mark-pdf-ready.mjs as plain Node child processes — no agent
      // CLI or its sandbox involved — so a browser launch never depends on an
      // interactive approval nobody is present to grant in a headless/web-
      // triggered run (#2172). The tracker is marked ✅ only after a CONFIRMED
      // successful render, not optimistically — same honesty-gate discipline as
      // the evaluate path below.
      const renderPdf = async (paths: PdfPaths, format: "letter" | "a4") => {
        send({ type: "status", label: "Rendering PDF…" });
        // renderAndMarkPdf is designed to resolve, never throw — but this is
        // the one place nothing else awaits or catches this promise (cancel()
        // only attaches a .finally for the write-token release), so an
        // unexpected exception here must still close the stream instead of
        // leaving it — and the write-token — open until process shutdown.
        try {
          const result = await renderAndMarkPdf({
            spawnFn: spawn,
            execPath: process.execPath,
            root: careerOpsRoot(),
            pdfPaths: paths,
            format,
            reportNum: input,
          });
          if (result.kind === "render-failed") {
            send({ type: "error", msg: result.error.slice(0, 200) });
            return;
          }
          // Non-fatal issues (a defaulted page format, a tracker row not marked) still
          // surface here rather than only in a server log nobody sees.
          sendWarnings(result.warnings);
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } catch (e) {
          send({ type: "error", msg: `PDF rendering crashed unexpectedly: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) });
        } finally {
          close();
        }
      };

      child.on("error", (e) => { send({ type: "error", msg: e.message }); close(); });
      child.on("close", (code) => {
        // A trailing line with no newline would otherwise never be tested.
        if (stderrBuf) { flagStderrLine(stderrBuf); stderrBuf = ""; }
        // A client disconnect can fire cancel() (which kills `child`) before
        // this event finally arrives — killing a process doesn't make its
        // 'close' event disappear, just delays it. Without this guard a pdf
        // run could still start a brand-new render (and re-touch the tracker)
        // after the stream — and its writeToken guard — is already gone.
        if (closed) return;
        const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean
        // Shared by both honesty gates below — the pdf gate receives it as
        // pdfRunOutcome's noOutputMessage — because a CLI that produced no output at
        // all is the same failure mode whether it was evaluating or tailoring
        // a PDF — one place for the condition/message pair instead of two.
        const noOutputError = (): string | null => {
          if (!emittedText && !sawError && !cleanExit) return "The CLI exited with an error — is it installed and authenticated?";
          if (!emittedText && !sawError) return "The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)";
          return null;
        };

        if (kind === "pdf") {
          // Release any text the filter was still holding, so the log keeps the
          // agent's closing narration and its VERDICT line.
          const tail = cvFilter?.flush();
          if (tail) send({ type: "text", text: tail });
          // The artifact check moved from the filesystem to the stream (#2185):
          // whether pdfPaths.html exists says nothing now that the backend is its
          // only writer. pdfRunOutcome owns the decision and the message.
          const envelope = cvFilter?.result();
          const outcome = pdfRunOutcome({
            envelope,
            noOutputMessage: noOutputError(),
            sawError,
            cleanExit,
            hasPaths: pdfPaths !== undefined,
          });
          if (!outcome.ok) {
            send({ type: "error", msg: outcome.message });
          } else if (!pdfPaths || envelope?.ok !== true) {
            // Unreachable: pdfRunOutcome validated both via hasPaths/envelope.ok.
            // Kept for narrowing, but it must REPORT rather than fall through to a
            // bare close() — a stream that ends with neither error nor done is the
            // one outcome this handler exists to prevent.
            send({ type: "error", msg: "Internal error: the pdf run passed its gate with no CV to save — please report this." });
          } else {
            sendWarnings(envelope.warnings);
            if (saveCv(pdfPaths, envelope)) {
              // Tracked so cancel() can defer releasing writeToken until this
              // settles; close() happens once rendering finishes, not here.
              pdfRenderPromise = renderPdf(pdfPaths, envelope.format);
              return;
            }
            // saveCv already streamed the specific reason.
          }
          return close();
        }

        const wroteReport = countReports() > reportsBefore;
        // Honesty gate (#9): a green "done" with a parsed score requires a CLEAN exit,
        // real output, AND (for evaluations) a report actually written. Anything else
        // is surfaced — an errored run must never be banked as a confident score.
        const baseErr = noOutputError();
        if (baseErr) {
          send({ type: "error", msg: baseErr });
        } else if (persists && !wroteReport) {
          // The worker ran but never wrote the report/tracker row (e.g. a CLI
          // without file-write authorization) — surface it instead of a fake score.
          send({ type: "error", msg: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code." });
        } else if (!cleanExit || sawError) {
          // Produced output (maybe even a report) but did NOT finish cleanly — flag it
          // instead of recording a confident score off a half-finished run.
          send({ type: "error", msg: "This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify." });
        } else {
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        }
        close();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      if (pdfRenderPromise) {
        // Render/mark keeps running after this client disconnects — wait for
        // it to settle before releasing the guard, so a concurrent tracker
        // delete can't race mark-pdf-ready.mjs's still-in-flight write.
        pdfRenderPromise.finally(releaseWriteTokenOnce);
      } else {
        releaseWriteTokenOnce();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
