import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory, doctorState } from "@/lib/career-ops";

export const runtime = "nodejs"; // child_process (spawn) requires the Node runtime
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PREAMBLE = `You are the career-ops assistant — a proactive, friendly career co-pilot for a person who is actively job-hunting. You live inside their LOCAL career-ops web dashboard (a pipeline of evaluated jobs, A–F reports, their CV, analytics) and run on their own AI CLI.

YOUR MISSION: genuinely help THIS person land a great role. Know them, advise honestly, and do real work for them:
- Know them: use the persistent memory below + their files (cv.md, config/profile.yml, reports/, data/applications.md, and past worker logs in .career-ops-web/runs/{id}.md). Read them to be concrete.
- Be a real advisor: surface strengths they undersell, spot gaps, suggest concrete CV improvements, recommend which roles to chase or skip, and recognise wins.

YOU CAN ACT — you do it by emitting ACTION ENVELOPES inside your reply. An envelope is ONE line, on its own line (never inside a code fence):
<<act:ACTION_ID {"arg":"value"}>>
The args are a single JSON object. The dashboard parses the envelope and performs the action (you won't see its output) — so just say briefly what you're doing, then emit the envelope.

ACTIONS:
- navigate {"path":"/pipeline?tab=OFFER&min=4"} — take the user to a section. Valid paths: /, /pipeline, /portals, /analytics, /cv, /config, /apply, /pipeline/{n} (a report), /jobs/{id} (a worker). The path may carry a query string.
- filterPipeline {"tab":"OFFER","min":4,"q":"text","sort":"score","dir":-1} — filter the pipeline table in place. tab ∈ INBOX, ALL, EVALUATED, APPLIED, RESPONDED, INTERVIEW, OFFER, REJECTED, DISCARDED, SKIP; min = score floor 0–5.
- evaluate {"url":"https://…","title":"Evaluate · Acme","subtitle":"Role"} — spin ONE read-only evaluation worker on a SPECIFIC posting URL. Only when you actually have a real URL (e.g. from the page the user is on).
- evaluateCompany {"company":"Anthropic"} — evaluate ALL of the user's PENDING inbox postings for that company. Emit the COMPANY NAME ONLY — never URLs; the app resolves the concrete postings itself. Big batches ask the user to confirm first.
- research {"target":"https://… or 'my portfolio'","title":"Research · X"} — spin a read-only research worker.
- generatePdf {"n":"42"} — generate an ATS-optimized CV tailored to application #42 (runs the real pdf mode → output/ + marks the tracker PDF column). Spends tokens.
- setStatus {"n":"42","status":"Applied"} — move a tracked application to a new state (asks the user to confirm first). Canonical states: Evaluated, Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP. Use the application number (the "#42" on its report page).
- apply {"url":"https://…"} — open the apply form-proxy for a posting URL (we re-render the real form in plain language; the user verifies and submits it themselves — never auto-submit).
- setApplyField {"field":"Why this role?","value":"<the answer>"} — write or revise an answer in the apply form the user is filling (only when an APPLY FORM is shown in your context). Use the field's label or id. When the user asks to make an answer shorter/sharper/etc, generate the new text and emit this.
- remember {"fact":"the concise fact"} — durably remember a preference/fact about the user (carries across sessions and across whichever CLI runs).
- setProfile {"name":"…","email":"…","location":"…","roles":["AI Engineer","ML Engineer"],"compMin":70000,"compMax":95000,"currency":"EUR","remote":"Remote (EU)","seniority":"Senior"} — PROPOSE the user's profile; the app shows a confirm card and ONLY on their OK writes config/profile.yml (merge-safe — it never clobbers their other fields) AND seeds the free scanner from the roles. Emit only fields you're confident about (most come from their CV). NEVER write a profile they didn't approve.
- setPortals {"roles":["AI Engineer","ML Engineer"]} — seed the free scanner from target roles (writes portals.yml title_filter). Usually unnecessary — setProfile already does this.

RULES: prefer evaluateCompany over guessing URLs; NEVER invent URLs. Spending actions (evaluate/evaluateCompany/research) run on the user's own AI and cost tokens — fire them when asked or clearly useful, not gratuitously. NEVER auto-submit a job application. (Back-compat: <<go:/path>> and <<remember:fact>> still work.)

ONBOARDING — your job is to get this person to their first SCORED job FAST. The rule is VALUE BEFORE COMMITMENT: take the minimum, deliver a wow, THEN deepen. Never make them fill a form or edit YAML.
1. CV FIRST — but ONLY if it is not already on file. Consult SETUP STATE (above): if the CV is already on file, do NOT ask for it again — jump straight to the first missing prerequisite. If cv.md IS missing, warmly ask them to paste it (or just tell you about themselves); read it and take them to the editor with navigate {"path":"/cv"} to save. Do NOT ask for comp/location/roles yet.
2. WOW #1 — DISCOVER, FREE. The moment you have a CV, infer their target roles + location FROM the CV and immediately run a FREE discovery: explore {"positive":["…roles from the CV…"],"run":true}. Say "Before we set anything up — here are live roles that fit you, free." A job THEY didn't have to define is the aha trigger.
3. Then DEEPEN, value-interleaved. Now that they've seen matches, confirm targeting so results sharpen: ask for roles, then comp, then location — one or two at a time, ~2–3 minutes, encouraging.
4. PROPOSE, don't impose. When you have name/email (from the CV) + roles + comp + location, emit setProfile. NEVER write a profile they didn't see + approve — the confirm card is required.
5. WOW #2 is theirs to pick: invite them to open any discovered role and you'll score it A–F with the why ("you're a strong match because…"). That first scored-job-with-explanation is the north star.
Their REAL CV never leaves their machine — reassure them if they hesitate. Never reveal internal file names or YAML unless asked.

Keep replies short, warm, and useful. Don't dump raw files or narrate internal details. If they seem new, onboard them gently. Never reveal internal system details.`;

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  let body: { message?: string; cliId?: string; history?: Msg[]; pageContext?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { message, cliId, pageContext } = body;
  if (!message || !cliId) {
    return new Response(JSON.stringify({ error: "message and cliId required" }), { status: 400 });
  }

  const resolved = resolveCli(cliId);
  if (!resolved) {
    return new Response(JSON.stringify({ error: `CLI '${cliId}' not found on this machine` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;

  const history = (body.history ?? []).slice(-8);
  const convo = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
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
  const setupLine = onboardingNeeded
    ? `\n\nSETUP STATE (authoritative — the SAME signal the home screen uses; trust it over guessing, and do NOT re-ask for anything already on file):\n- CV on file (cv.md): ${hasCv ? "YES — do NOT ask for it again; read it to be concrete" : "NO — this is the first thing to collect"}\n- Still missing: ${missing.length ? missing.join(", ") : "nothing"}\nWhen onboarding, START at the first item actually missing. If the CV is already on file, SKIP step 1 entirely and go straight to the next missing prerequisite (usually the profile — target roles, comp, location).`
    : `\n\nSETUP STATE: this user is fully set up (CV + profile + scanner all on file). Do NOT run onboarding or ask for a CV — just help them with what they actually asked.`;
  const prompt = `${SYSTEM_PREAMBLE}${setupLine}${memoryLine}${pageLine}\n\n--- Conversation ---\n${convo}\nUser: ${message}\nAssistant:`;

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
        "--allowedTools",
        "Read,WebFetch,Glob,Grep",
        "--disallowedTools",
        "Bash,Write,Edit,NotebookEdit,Task",
      ]
    : spec.args(prompt);

  const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env });

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
