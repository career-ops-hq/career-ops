import { pathToFileURL } from "node:url";
import { buildConversationContext } from "@/lib/assistant-history.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { cliSubstitutionNotice, cliUnavailableError, resolveCliOrFallback } from "@/lib/clis";
import { careerOpsRoot, readMemory, doctorState, rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { profileRef } from "@/lib/core/profile-path.mjs";
import { buildSystemPreamble } from "@/lib/assistant-preamble.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";
import { scopeFrom } from "@/lib/claude-invocation.mjs";
import { fencingReport } from "@/lib/cli-fencing.mjs";

// Deny list DERIVED, never hand-written: every one of the six advisor argvs
// that spelled its own omitted MultiEdit, which --permission-mode acceptEdits
// then auto-approves (#2185, #2507).
const ADVISOR_SCOPE = scopeFrom("Read,WebFetch,Glob,Grep");
import { readPersonalizationState } from "@/lib/personalization-file.mjs";
import { readJsonObject } from "@/lib/json-body";

/**
 * Human labels of the modes/_profile.md sections still identical to the template.
 * null = could not be determined (profile or template unreadable): the caller
 * must say so rather than report "filled" or ask for writes that would fail.
 */
async function personalizationGeneric(): Promise<string[] | null> {
  try {
    const core = await import(/* webpackIgnore: true */ pathToFileURL(rootScript("lib/personalization")).href);
    return readPersonalizationState(careerOpsRoot(), resolveCodeRoot(process.cwd(), process.env), core).sections
      .filter((s: { state: string }) => s.state !== "filled")
      .map((s: { heading: string }) => s.heading.replace(/^## Your /, "").toLowerCase());
  } catch {
    return null;
  }
}

export const runtime = "nodejs"; // child_process (spawn) requires the Node runtime
export const dynamic = "force-dynamic";
export const maxDuration = 120;


type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const body = await readJsonObject<{ message?: string; cliId?: string; history?: Msg[]; pageContext?: string }>(req);
  if (!body) return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  const { message, cliId: requestedCliId, pageContext } = body;
  if (!message || !requestedCliId) {
    return new Response(JSON.stringify({ error: "message and cliId required" }), { status: 400 });
  }

  const resolved = resolveCliOrFallback(requestedCliId);
  if (!resolved) {
    return new Response(JSON.stringify(cliUnavailableError(requestedCliId)), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;
  // The CLI actually running: fencing and argv below are keyed on it.
  const cliId = spec.id;
  const substitution = cliSubstitutionNotice(resolved);

  let convo: string;
  try { convo = buildConversationContext(body.history ?? []); }
  catch { return Response.json({ error: "Invalid conversation history" }, { status: 400 }); }
  const pageLine = pageContext
    ? `\n\nCURRENT PAGE (the user is looking at this right now): ${pageContext}\nWhen the user's message is ambiguous ("this", "it", "apply", "evaluate this", "draft it"), assume it refers to what's on the current page.`
    : "";
  const memory = readMemory();
  const memoryLine = memory.trim()
    ? `\n\nWHAT YOU KNOW ABOUT THE USER (persistent memory — carries across sessions and CLIs):\n${memory.trim()}`
    : "\n\n(No persistent memory about the user yet — learn and use <<remember:>> as you go.)";
  // Hand the assistant the SAME authoritative setup signal the home screen reads
  // (doctorState), so it never re-asks for a file that already exists (disc#7) —
  // the home was correctly nudging for the missing PROFILE while the assistant,
  // given no state, restarted its onboarding script and asked for the CV again.
  const { hasCv, onboardingNeeded, missing } = doctorState();
  // Personalization sections still on the shipped template: the fourth
  // prerequisite is "present" the moment doctor auto-copies the template, so
  // doctorState alone would call a generic file "done". Section state is what
  // tells the assistant which parts of the brief are still not this person's.
  const generic = await personalizationGeneric();
  const personalizationLine = generic === null
    ? "\n- Personalization: could not be read right now — do NOT emit setPersonalization and do NOT say it is complete; if the user asks, tell them the personalization file could not be read"
    : generic.length
      ? `\n- Personalization still on the template (ask about these, then setPersonalization): ${generic.join(", ")}`
      : "\n- Personalization: filled";
  const setupLine = onboardingNeeded || generic === null || generic.length
    ? `\n\nSETUP STATE (authoritative — the SAME signal the home screen uses; trust it over guessing, and do NOT re-ask for anything already on file):\n- CV on file (cv.md): ${hasCv ? "YES — do NOT ask for it again; read it to be concrete" : "NO — this is the first thing to collect"}\n- Still missing: ${missing.length ? missing.join(", ") : "nothing"}${personalizationLine}\nWhen onboarding, START at the first item actually missing. If the CV is already on file, SKIP step 1 entirely and go straight to the next missing prerequisite (usually the profile — target roles, comp, location), then the personalization sections still on the template.`
    : `\n\nSETUP STATE: this user is fully set up (CV + profile + scanner + personalization all on file). Do NOT run onboarding or ask for a CV — just help them with what they actually asked.`;
  const prompt = `${buildSystemPreamble(profileRef(careerOpsRoot()))}${setupLine}${memoryLine}${pageLine}\n\n--- Conversation ---\n${convo}\nUser: ${message}\nAssistant:`;

  // Claude Code streams token-level deltas via stream-json + partial messages.
  // Other CLIs: pass their stdout through raw.
  // The chat CLI is READ-ONLY: all writes go through gated registry actions
  // (remember → /api/memory, setStatus → /api/status), never the CLI editing
  // files directly. Scope its tools so it can advise (read) but not blind-write.
  const isClaude = cliId === "claude";
  // allowedTools must be COMMA-separated; disallowedTools is the hard guardrail
  // so the advisor can read (and WebFetch) but never blind-writes or shells out.
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
        "--allowedTools",
        ADVISOR_SCOPE.allowed,
        "--disallowedTools",
        ADVISOR_SCOPE.disallowed,
      ]
    : spec.args(prompt);

  // The advisor reads and fetches but must never write — the same intent the
  // Claude branch spells as Read,WebFetch,Glob,Grep with Bash/Write/Edit denied.
  // networkReadOnly, not localReadOnly, because WebFetch is in that allow list.
  let child;
  try {
    child = spawnHeadlessCli(
      binPath,
      args,
      { cwd: careerOpsRoot(), env: process.env },
      { cliId, capabilities: CAPS.networkReadOnly },
    );
  } catch (e) {
    // Fencing refuses an argv that contradicts the capability record. Report it
    // in this route's own error shape rather than letting the throw escape POST
    // as an unhandled rejection and an unstructured 500.
    return Response.json({ error: e instanceof Error ? e.message : "failed to start the CLI" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  // `closed` + kill timer in the OUTER scope so cancel() can flip `closed` before
  // the child's late handlers run — otherwise they enqueue onto an already-closed
  // controller and throw an uncaught "Controller is already closed" (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emitted = false;
      killer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, 90_000);
      const safeClose = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
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
      const emit = (s: string) => {
        if (safeEnqueue(s)) emitted = true;
      };
      // Same honesty as /api/run: a runtime with no verified fencing mechanism
      // runs with its default access, and that must be visible rather than
      // inferred from which CLI happens to be selected (#2507). This stream is
      // plain text, so the notice is a leading line rather than an event.
      const fencing = fencingReport({ cliId, cliName: spec.name, capabilities: CAPS.networkReadOnly });
      if (fencing.notice) safeEnqueue(`⚠️ ${fencing.notice}

`);
      if (substitution) safeEnqueue(`⚠️ ${substitution}\n\n`);

      child.stdout.on("data", (d: Buffer) => {
        if (closed) return;
        if (!isClaude) {
          emit(d.toString());
          return;
        }
        // line-buffered NDJSON → emit only assistant text deltas
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
        if (/error|not found|denied|fatal/i.test(s)) {
          safeEnqueue(`\n[${spec.name}] ${s.trim()}\n`);
        }
      });
      child.on("error", (e) => {
        safeEnqueue(`\n[error launching ${spec.name}: ${e.message}]`);
        safeClose();
      });
      child.on("close", () => {
        if (!emitted) {
          safeEnqueue("_(no output — is the CLI authenticated?)_");
        }
        safeClose();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
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
