import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliSubstitutionNotice, cliUnavailableError, resolveCliOrFallback } from "@/lib/clis";
import { readMemory } from "@/lib/career-ops";
import { assembleDedupContext } from "@/lib/core/discover";
import { CAPS } from "@/lib/worker-capabilities.mjs";
import { scopeFrom } from "@/lib/claude-invocation.mjs";
import { fencingReport } from "@/lib/cli-fencing.mjs";
import { codexFencingSupported } from "@/lib/cli-fencing-probe.mjs";
import { canon, makeAiStreamParser } from "@/lib/explore-ai";
import { buildAiSearchPrompt } from "./prompt";

// Deny list DERIVED, never hand-written: every one of the six advisor argvs
// that spelled its own omitted MultiEdit, which --permission-mode acceptEdits
// then auto-approves (#2185, #2507).
const ADVISOR_SCOPE = scopeFrom("Read,WebFetch,WebSearch,Glob,Grep");

// Isolation and output flags this route adds to the exec argv itself — not
// permission, so not fencing's (#2507), but a Codex build missing one breaks the
// run just as thoroughly, so the capability gate below checks them too.
const CODEX_ISOLATION_FLAGS = ["--strict-config", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check"];
const CODEX_OUTPUT_FLAG = "--output-last-message";

// AI search orchestrates modes/web-search.md by running the USER'S configured CLI
// headless (CLI-agnostic, like the assistant). Web hunting is slow → generous
// budget. The agent is a PROPOSER: Write/Edit/Bash are disabled so it structurally
// cannot persist; the only writes happen when the user later ADDs a candidate.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  let body: { query?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const query = (body.query || "").trim();
  const requestedCliId = body.cliId;
  if (!query || !requestedCliId) return Response.json({ error: "Faltam os termos da pesquisa e o agente." }, { status: 400 });

  const resolved = resolveCliOrFallback(requestedCliId);
  if (!resolved) return Response.json(cliUnavailableError(requestedCliId), { status: 404 });
  const { spec, binPath } = resolved;
  // The CLI actually running: the Codex isolation probe, fencing and argv below
  // are all keyed on it.
  const cliId = spec.id;
  const substitution = cliSubstitutionNotice(resolved);
  const fencing = fencingReport({ cliId, cliName: spec.name, capabilities: CAPS.webSearchOnly });
  if (fencing.level !== "full") {
    const reason = cliId === "cursor"
      ? "o modo Ask não desativa hooks globais que podem escrever fora do espaço isolado."
      : cliId === "gemini"
        ? "o modo plan pode permitir escrita e alterações de política; não há isolamento só de leitura verificado."
        : "não há isolamento só de leitura verificado para este agente.";
    return Response.json(
      { code: "CLI_UNFENCED", error: `A pesquisa com IA está bloqueada para ${spec.name}: ${reason} Escolhe Claude Code ou Codex.` },
      { status: 400 },
    );
  }

  // Read the CANONICAL mode at request time — single source of truth, never a
  // homegrown prompt. Missing (older core) → graceful 400 so the Scan tab stays usable.
  let prompt: string;
  try {
    const { lines } = assembleDedupContext();
    prompt = buildAiSearchPrompt({ query, memory: readMemory(), knownLines: lines });
  } catch {
    return Response.json({ code: "MODE_MISSING", error: "A pesquisa com IA exige uma versão mais recente do career-ops." }, { status: 400 });
  }

  const isClaude = cliId === "claude";
  const isCodex = cliId === "codex";

  if (isCodex && !(await codexFencingSupported(binPath, { alsoRequiresInExec: [...CODEX_ISOLATION_FLAGS, CODEX_OUTPUT_FLAG] }))) {
    return Response.json(
      {
        code: "CODEX_UNSUPPORTED",
        error:
          "O Codex instalado não suporta as opções de execução só de leitura exigidas. Atualiza-o e volta a tentar.",
      },
      { status: 400 },
    );
  }

  // The complete mode, memory and dedup context are embedded in `prompt`.
  // Every agent runs in a temporary cwd. Codex writes its final assistant
  // response to a dedicated file. Its normal console transcript includes the
  // full prompt and must never be forwarded to the Web UI.
  let childCwd: string;

  try {
    childCwd = fs.mkdtempSync(path.join(os.tmpdir(), `career-ops-${cliId}-`));
  } catch {
    return Response.json(
      {
        code: "CLI_TEMP_DIR_FAILED",
        error: `A pesquisa com IA não conseguiu criar um espaço isolado para ${spec.name}.`,
      },
      { status: 400 },
    );
  }

  const codexResultFile = isCodex
    ? path.join(childCwd, "final-response.txt")
    : undefined;

  const args = isClaude
    ? [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "acceptEdits",
        // --strict-mcp-config with no --mcp-config loads ZERO MCP servers, so the
        // tool lists here describe everything this agent can reach. Required for a
        // non-writing worker: without it a user MCP server could supply a write tool
        // the capability record forbids, and cli-fencing refuses to certify that (#2507).
        "--strict-mcp-config",
        // Per-session settings override user/project hooks without replacing HOME.
        "--settings",
        '{"disableAllHooks":true}',
        "--allowedTools",
        ADVISOR_SCOPE.allowed,
        "--disallowedTools",
        ADVISOR_SCOPE.disallowed,
      ]
    : isCodex
      ? [
          // Isolation and output only. Approval policy, the sandbox and web
          // access were spelled here by #2361 and now come from fencing, which
          // applies them to every Codex spawn instead of the one route that
          // remembered — and refuses this argv outright if it spells them again.
          "exec",
          ...CODEX_ISOLATION_FLAGS,
          CODEX_OUTPUT_FLAG,
          codexResultFile!,
          prompt,
        ]
      : spec.args(prompt);

  // POSIX process groups let cancellation/timeout terminate descendants too.
  const useProcessGroup = process.platform !== "win32";

  // Declared BEFORE the spawn: fencing can refuse the argv, and the temporary
  // workspace already exists by then. Without this the refusal path would leak
  // one directory per rejected request.
  const cleanupChildCwd = () => {
    try {
      fs.rmSync(childCwd, { recursive: true, force: true });
    } catch {
      /* best-effort temporary-directory cleanup */
    }
  };

  // Proposer-not-writer, as the Claude branch above spells it: Read + WebFetch +
  // WebSearch allowed, every write tool denied. Its web use is search-shaped —
  // it hunts for postings rather than being handed a url to retrieve — so
  // `search`, not the costlier `networkReadOnly`: that is what lets Codex keep
  // the genuine read-only sandbox #2361 gave this route instead of trading it
  // for a writable workspace. Claude is unaffected; its tools are not sandboxed
  // and it still gets WebFetch (see ADVISOR_SCOPE).
  let child;
  try {
    child = spawnHeadlessCli(
      binPath,
      args,
      { cwd: childCwd, env: process.env, detached: useProcessGroup },
      { cliId, capabilities: CAPS.webSearchOnly },
    );
  } catch (e) {
    // Fencing refuses an argv that contradicts the capability record. Report it
    // in this route's own error shape rather than letting the throw escape POST
    // as an unhandled rejection and an unstructured 500.
    cleanupChildCwd();
    return Response.json({ error: e instanceof Error ? e.message : "Não foi possível iniciar o agente." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  // `closed` + kill timer in the OUTER scope so cancel() can flip `closed` before
  // the child's late handlers run — otherwise they enqueue onto an already-closed
  // controller and throw an uncaught "Controller is already closed" (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;

  const isChildAlive = () => {
    if (!useProcessGroup) return child.exitCode === null && child.signalCode === null;
    if (!child.pid) return false;

    try {
      process.kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const clearTerminationTimers = () => {
    if (killer) {
      clearTimeout(killer);
      killer = undefined;
    }

    // If the group leader exited but a descendant ignored SIGTERM, retain the
    // SIGKILL fallback until the remaining process group is gone.
    if (forceKill && !isChildAlive()) {
      clearTimeout(forceKill);
      forceKill = undefined;
    }
  };

  const signalChild = (signal: NodeJS.Signals): boolean => {
    if (useProcessGroup && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch {
        /* group may already be gone; fall back to the direct child */
      }
    }

    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  };

  const terminateChild = () => {
    const termSent = signalChild("SIGTERM");

    if (!termSent || forceKill) return;

    forceKill = setTimeout(() => {
      signalChild("SIGKILL");
      forceKill = undefined;
    }, 5_000);

    forceKill.unref?.();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emitted = false;
      let usable = false;
      const resultParser = makeAiStreamParser();
      let codexStderr = "";
      killer = setTimeout(() => {
        terminateChild();
        cleanupChildCwd();
        terminal(usable ? "partial" : "error", `${spec.name}: a pesquisa excedeu o tempo limite.`);
        safeClose();
      }, 480_000);
      const safeClose = () => {
        if (!closed) {
          closed = true;
          clearTerminationTimers();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      const safeEnqueue = (s: string): boolean => {
        if (closed || !s) return false;
        try {
          controller.enqueue(encoder.encode(s));
          return true;
        } catch {
          closed = true; // controller already closed underneath us — stop, never crash
          return false;
        }
      };
      const terminal = (status: "success" | "partial" | "error", message?: string) => {
        safeEnqueue(`\n<<search-result:${JSON.stringify({ status, ...(message ? { message } : {}) })}>>\n`);
      };
      const emit = (s: string) => {
        if (!safeEnqueue(s)) return;
        if (s.trim()) emitted = true;
        // Narration and partial/malformed envelopes are not completed results.
        usable ||= resultParser.feed(s).some((chunk) => chunk.kind === "offer" && chunk.offer.title && chunk.offer.company && canon(chunk.offer.url));
      };
      if (substitution) safeEnqueue(`⚠️ ${substitution}\n\n`);

      child.stdout.on("data", (d: Buffer) => {
        if (closed) return;

        // Codex's authoritative response is read from codexResultFile after
        // process completion. Drain but do not forward its console transcript.
        if (isCodex) return;

        if (!isClaude) {
          emit(d.toString());
          return;
        }
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "stream_event" && obj.event?.type === "content_block_delta") {
              const text = obj.event.delta?.text;
              if (typeof text === "string") emit(text);
            }
          } catch {
            /* partial / non-json line — skip */
          }
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        const s = d.toString();

        if (isCodex) {
          // Normal Codex stderr contains session metadata and the complete
          // prompt. Retain only a bounded private diagnostic signal and never
          // stream it during a successful request.
          codexStderr = (codexStderr + s).slice(-16_000);
          return;
        }

        // Drain every CLI's stderr without forwarding prompt/secret-bearing text.
      });
      child.on("error", () => {
        terminal("error", `Não foi possível iniciar ${spec.name}.`);
        cleanupChildCwd();
        safeClose();
      });

      child.on("close", (code) => {
        clearTerminationTimers();

        if (closed) {
          cleanupChildCwd();
          return;
        }

        if (isCodex) {
          let finalText = "";

          try {
            if (codexResultFile && fs.existsSync(codexResultFile)) {
              finalText = fs.readFileSync(codexResultFile, "utf8").trim();
            }
          } catch {
            /* handled below as missing final output */
          }

          if (finalText) {
            emit(finalText);
          }
          if (code !== 0 && !usable) {
            const diagnosticText = codexStderr.trim();
            const diagnosticsCaptured = diagnosticText.length > 0;

            if (diagnosticsCaptured) {
              const lowerDiagnostics = diagnosticText.toLowerCase();
              const diagnosticMarkers = [
                "error",
                "fatal",
                "failed",
                "denied",
                "not found",
                "invalid",
                "unsupported",
              ].filter((marker) => lowerDiagnostics.includes(marker));

              // Codex stderr may contain the complete user prompt. Log only
              // bounded metadata and marker categories, never its contents.
              console.error("[Codex AI search exited without a final response]", {
                exitCode: code ?? "unknown",
                stderrBytes: Buffer.byteLength(diagnosticText, "utf8"),
                stderrLines: diagnosticText.split(/\r?\n/).length,
                diagnosticMarkers,
              });
            }

            safeEnqueue(
              `
[Codex exited with code ${code ?? "unknown"}${
                diagnosticsCaptured ? "; diagnostic output captured" : ""
              }]
`,
            );
          } else if (!emitted) {
            safeEnqueue("_(o Codex não devolveu um resultado final)_");
          }

          cleanupChildCwd();
          terminal(code === 0 ? "success" : usable ? "partial" : "error", code === 0 ? undefined : `${spec.name} terminou com o código ${code ?? "desconhecido"}.`);
          safeClose();
          return;
        }

        if (code !== 0 && !usable) safeEnqueue(`\n[${spec.name} terminou com o código ${code ?? "desconhecido"}]\n`);
        else if (!emitted) safeEnqueue("_(o agente não devolveu conteúdo; confirma se tem sessão iniciada)_");
        cleanupChildCwd();
        terminal(code === 0 ? "success" : usable ? "partial" : "error", code === 0 ? undefined : `${spec.name} terminou com o código ${code ?? "desconhecido"}.`);
        safeClose();
      });
    },
    cancel() {
      closed = true;

      if (killer) {
        clearTimeout(killer);
        killer = undefined;
      }

      terminateChild();
      cleanupChildCwd();
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
