import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { spawnCli } from "@/lib/cli-spawn";
import { buildCliArgs, buildCliEnv, detectCliPlaintextError, processStreamJsonLines, usesStreamJson } from "@/lib/cli-stream";
import { careerOpsRoot, findApplication, primaryReportNum, readMemory } from "@/lib/career-ops";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";
import { buildPrompt } from "@/lib/run-prompts.mjs";
import { claudeCliArgs, toolScopeFor } from "@/lib/claude-invocation.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

// The web ORCHESTRATES the real career-ops engine — it does NOT reimplement it.
// kind "evaluate" runs the REAL modes/oferta.md and persists the canonical
// artifacts (A–F report + tracker row) via the SAME scripts the CLI uses.
// Prompts live in run-prompts.mjs; Claude tool/sandbox argv is built ONLY by
// claudeCliArgs (route may not spell tool flags — #2185). Streams NDJSON.

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
  const needsScript: Record<string, string> = {
    evaluate: "modes/oferta.md",
    "fix-portal": "verify-portals.mjs",
    pdf: "generate-pdf.mjs",
    cover: "generate-cover-letter.mjs",
  };
  const required = needsScript[kind];
  if (required && !fs.existsSync(path.join(careerOpsRoot(), required))) {
    return new Response(
      JSON.stringify({
        error: `This needs a complete career-ops checkout (${required}). CAREER_OPS_ROOT has data only — point it at a full checkout.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  if ((kind === "evaluate" || kind === "pdf" || kind === "cover") && !fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return new Response(
      JSON.stringify({ error: "Add your CV first so I can score this against you — drop it on the home page." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // Web job inputs are tracker ROW ids; report filenames / pdf-index keys are
  // REPORT numbers, which diverge after a re-eval renumbers the Report cell
  // (row 135 ↔ report 144). Resolve the real report # for pdf/cover prompts.
  const reportNum =
    kind === "pdf" || kind === "cover" ? primaryReportNum(findApplication(input), input) : input;
  const prompt = buildPrompt({ kind, input, memory: readMemory(), today, reportNum });

  const streamJson = usesStreamJson(cliId);
  // Tool/sandbox scope comes from claude-invocation (values asserted at #2185).
  // research is read-only; evaluate/fix-portal/pdf/cover may shell out to core
  // scripts. NEVER auto-submits — that is a prompt-level guarantee.
  const scope = toolScopeFor(kind);
  const args =
    cliId === "claude"
      ? claudeCliArgs({ kind, prompt, permissionMode: "acceptEdits" })
      : buildCliArgs(cliId, spec, {
          prompt,
          allowedTools: scope.allowed,
          disallowedTools: scope.disallowed,
          needsShell: scope.needsShell,
        });

  // For write-needing kinds, snapshot report FILENAMES so we can verify THIS
  // run persisted (a global count races a concurrent eval of the same URL).
  // Ignore reservation sentinels (*-RESERVED.md) — they are not reports.
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const listReportFiles = (): Set<string> => {
    try {
      return new Set(
        fs
          .readdirSync(reportsDir)
          .filter((f) => f.endsWith(".md") && !f.endsWith("-RESERVED.md")),
      );
    } catch {
      return new Set();
    }
  };
  const persists = kind === "evaluate";
  const reportsBefore = persists ? listReportFiles() : null;

  // pdf/cover artifact gate: "done" must mean a viewable file landed, not just
  // that the CLI printed text and exited 0 (30 Sundays: job done, no PDF →
  // View 404 → Generate reappeared once localStorage dropped the job).
  // Same-day regenerations overwrite one filename — track mtime, not just names.
  const outputDir = path.join(careerOpsRoot(), "output");
  const isArtifactName = (f: string): boolean =>
    kind === "pdf"
      ? f.startsWith("cv-") && f.endsWith(".pdf") && !f.endsWith("-cover.pdf")
      : f.endsWith("-cover.pdf");
  const listArtifacts = (): Map<string, number> => {
    const m = new Map<string, number>();
    try {
      for (const f of fs.readdirSync(outputDir)) {
        if (isArtifactName(f)) m.set(f, fs.statSync(path.join(outputDir, f)).mtimeMs);
      }
    } catch {
      /* missing output/ → empty snapshot */
    }
    return m;
  };
  const needsArtifact = kind === "pdf" || kind === "cover";
  const artifactsBefore = needsArtifact ? listArtifacts() : null;
  const wroteArtifact = (): boolean => {
    if (!artifactsBefore) return true;
    try {
      for (const f of fs.readdirSync(outputDir)) {
        if (!isArtifactName(f)) continue;
        const prev = artifactsBefore.get(f);
        if (prev === undefined || fs.statSync(path.join(outputDir, f)).mtimeMs > prev) return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  // Tracker-mutating runs hold a write token so a row delete can't race their merge
  // (tracker.mjs delete doesn't yet share a lock with merge-tracker — see run-registry).
  let writeToken: number | null = null;

  let child;
  try {
    // opencode's headless scope rides in OPENCODE_CONFIG_CONTENT (no per-tool
    // argv); everything else gets an empty env and stays CLI-agnostic. The env
    // only DELETES or re-scopes tool permissions — the no-auto-submit guarantee
    // is prompt-level and untouched by this.
    const cliEnv = buildCliEnv(cliId, { allowedTools: scope.allowed, disallowedTools: scope.disallowed });
    child = spawnCli(binPath, args, { cwd: careerOpsRoot(), env: { ...process.env, ...cliEnv } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "failed to start CLI" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  writeToken = kind === "evaluate" || kind === "pdf" ? acquireTrackerWrite() : null;
  const enc = new TextEncoder();

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before the child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emittedText = false; // any assistant text delta → the CLI actually ran
      let sawError = false; // heuristic noise (stderr / non-zero exit) — not a verdict by itself
      let warnedStderr = false; // at most one ⚠ step for the whole run
      let lastTokens = 0; // per-run token cost from the Claude result event (#6) — local only
      let lastCostUsd: number | null = null;
      // pdf-mode tailors a full CV + renders it — give it more headroom.
      const killMs = kind === "pdf" ? 720_000 : 285_000;
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
          if (writeToken !== null) releaseTrackerWrite(writeToken);
          try { controller.close(); } catch { /* */ }
        }
      };

      child.stdout.on("data", (d: Buffer) => {
        if (closed) return;
        if (!streamJson) {
          emittedText = true;
          send({ type: "text", text: d.toString() });
          return;
        }
        buf = processStreamJsonLines(cliId, buf + d.toString(), (text) => {
          emittedText = true;
          send({ type: "text", text });
        }, (meta) => {
          // Stream-json auth failures are terminal — the CLI cannot continue.
          if (meta.authError) {
            sawError = true;
            send({ type: "error", msg: meta.authError });
          }
          if (meta.toolName) send({ type: "tool", name: meta.toolName });
          if (meta.status) send({ type: "status", label: meta.status });
          if (meta.tokens != null) lastTokens = meta.tokens;
          if (meta.costUsd != null) lastCostUsd = meta.costUsd;
        });
      });
      child.stderr.on("data", (d: Buffer) => {
        const raw = d.toString();
        // Heuristic ONLY — never finish the job mid-run on stderr text. OpenCode
        // (and other CLIs) echo `$ cmd` / UI noise to stderr; a chunk can start
        // with `$ node company-history.mjs` and still contain "error"/"auth"
        // from a coalesced write. Record the hit; the close gate decides.
        const hit = /error|denied|fatal|not found|unauthorized|forbidden|auth|login|credential|api[ -]?key|quota|rate limit|not authenticated/i.test(raw);
        if (!hit) return;
        sawError = true;
        // Quiet: one warning max, and skip pure shell-echo lines (`$ cmd…`).
        if (warnedStderr) return;
        const clean = raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
        const lines = clean
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        // Prefer a line that looks like a message, not a prompt/echo of a command.
        const msgLine = lines.find(
          (l) =>
            /error|denied|fatal|not found|unauthorized|forbidden|not authenticated|quota|rate limit/i.test(l) &&
            !/^\$\s/.test(l) &&
            !/\brtk\b|\bnode\s+\S+\.mjs\b|\becho\b|\bhead\b|\btail\b/.test(l),
        );
        if (!msgLine) return; // command-echo noise only — sawError stays, no ⚠ step
        warnedStderr = true;
        send({ type: "warning", msg: msgLine.replace(/\s+/g, " ").slice(0, 200) });
      });
      child.on("error", (e) => { send({ type: "error", msg: e.message }); close(); });
      child.on("close", (code) => {
        // Spawn-level / proxy plaintext failures are terminal.
        const tailErr = detectCliPlaintextError(buf);
        if (tailErr) {
          sawError = true;
          send({ type: "error", msg: tailErr });
          close();
          return;
        }
        // THIS run must have added a report file — not merely a higher global
        // count (a concurrent eval could have written someone else's report).
        let wroteReport = true;
        if (persists && reportsBefore) {
          wroteReport = false;
          try {
            for (const f of fs.readdirSync(reportsDir)) {
              if (f.endsWith(".md") && !f.endsWith("-RESERVED.md") && !reportsBefore.has(f)) {
                wroteReport = true;
                break;
              }
            }
          } catch {
            wroteReport = false;
          }
        }
        const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean
        const artifactOk = !needsArtifact || wroteArtifact();
        // Honesty gate (#9): a green "done" with a parsed score requires real
        // output AND (for evaluations) a report THIS run wrote. Stderr keyword
        // hits and a dirty exit are warnings when artifacts landed — evidence
        // outranks heuristics. Hard-fail only when the run produced nothing
        // useful (no output, evaluate with no new report, or pdf/cover with no
        // file — a "done" job whose View would 404 is worse than a red card).
        if (!emittedText) {
          if (!cleanExit) {
            send({ type: "error", msg: "The CLI exited with an error — is it installed and authenticated?" });
          } else {
            send({ type: "error", msg: "The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)" });
          }
        } else if (persists && !wroteReport) {
          send({ type: "error", msg: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code." });
        } else if (needsArtifact && !artifactOk) {
          send({
            type: "error",
            msg:
              kind === "cover"
                ? "This run finished without writing a cover-letter PDF under output/ — nothing to view. Re-run Generate."
                : "This run finished without writing a CV PDF under output/ — nothing to view. Re-run Generate CV.",
          });
        } else if (cleanExit && !sawError) {
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } else if ((persists && wroteReport) || (needsArtifact && artifactOk)) {
          // Report/PDF landed despite stderr noise / non-zero exit — bank it as
          // done with a visible warning so the card is honest without lying red.
          send({
            type: "status",
            label: cleanExit
              ? `Finished with stderr warnings (${persists ? "report" : "PDF"} saved)`
              : `Exit ${code ?? "signal"} after ${persists ? "report" : "PDF"} saved`,
          });
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } else if (cleanExit) {
          // Non-persist kind: output + clean exit is enough even if stderr tripped.
          send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
        } else {
          send({ type: "error", msg: "This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify." });
        }
        close();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      if (writeToken !== null) releaseTrackerWrite(writeToken);
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
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
