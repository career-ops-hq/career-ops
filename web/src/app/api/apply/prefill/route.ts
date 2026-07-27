import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { getSession } from "@/lib/apply/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

/**
 * Pull a JSON object out of an LLM's text answer, tolerating code fences,
 * trailing prose, and — crucially — TRUNCATION (the planner getting killed
 * mid-output on a big form). When the object is incomplete we salvage the
 * largest valid prefix so the fields that DID finish still come through.
 */
function extractJsonObject(text: string): { obj: Record<string, unknown> | null; truncated: boolean } {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return { obj: null, truncated: false };

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end !== -1) {
    try {
      return { obj: JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>, truncated: false };
    } catch {
      /* malformed even though balanced — fall through to salvage */
    }
  }

  // Truncated / unbalanced: walk back from successive commas, close the JSON,
  // and parse the largest prefix that is valid.
  const frag = s.slice(start);
  const open = (frag.match(/{/g) || []).length;
  const close = (frag.match(/}/g) || []).length;
  const pad = "}".repeat(Math.max(0, open - close));
  for (let tryEnd = frag.length; tryEnd > 1; ) {
    const cand = frag.slice(0, tryEnd).replace(/,\s*$/, "") + pad;
    try {
      return { obj: JSON.parse(cand) as Record<string, unknown>, truncated: true };
    } catch {
      const prevComma = frag.lastIndexOf(",", tryEnd - 1);
      if (prevComma <= start) break;
      tryEnd = prevComma;
    }
  }
  return { obj: null, truncated: true };
}

// AI pre-fill (STREAMING NDJSON). The user's BYO CLI (read-only PLANNER — no
// browser access) drafts an answer per field from cv.md / profile / the job's
// report. We stream a live diagnostic log of every step (spawn, heartbeats,
// exit code/signal, parse outcome) so a stuck/empty prefill is observable on the
// page AND written to <root>/.career-ops-web/apply-prefill.log for debugging.
export async function POST(req: Request) {
  let body: { sessionId?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { sessionId, cliId } = body;
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
      const fail = (m: string, raw?: string) => {
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

      const fieldsList = s.fields
        .map((f) => `${f.id}\t${f.type}${f.required ? "*" : ""}\t${f.label}${f.options ? `\t[options: ${f.options.join(" | ")}]` : ""}`)
        .join("\n");
      const mem = readMemory().trim();
      const prompt = `You are pre-filling a job application for the user (company/role: ${s.title}). Read cv.md and config/profile.yml; if a matching report for this company exists in reports/, read it too. Ground EVERY answer in the REAL candidate — never invent facts.${mem ? `\n\nDurable notes about the user:\n${mem}` : ""}

FIELDS (id ⇥ type ⇥ label ⇥ options):
${fieldsList}

For each field give the best answer:
- identity/contact (name, email, phone, github, linkedin, location) → from profile/cv.
- free-text (Why us?, cover-letter, "most impactful thing you've built", etc.) → a concise, honest, concrete answer in the candidate's own voice (no buzzwords, active voice, real metrics only). Keep each under ~120 words.
- select/radio → choose the best-matching option using the EXACT option text from the list.
- NEVER fill legal / visa / work-authorization / salary / demographic / sensitive fields → set needs_confirmation:true and value:"".

Output ONLY a compact JSON object mapping each field id → {"value": "...", "needs_confirmation": boolean}. No prose, no markdown, no code fence.`;

      log(`Form: "${s.title}" · ${s.fields.length} fields · prompt ${prompt.length} chars · memory ${mem.length} chars`);
      log(`Planner: ${cliId} (${binPath})`);

      const isClaude = cliId === "claude";
      // --strict-mcp-config with no --mcp-config = load ZERO MCP servers → much
      // faster startup (skips the user's global playwright/gmail/linear/… servers
      // the planner doesn't need; it only reads local files).
      const args = isClaude
        ? ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", "Read,Glob,Grep", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch"]
        : spec.args(prompt);
      // Scale the timeout with form size (big forms = more drafting). Cap < maxDuration.
      const killMs = Math.min(300_000, 150_000 + s.fields.length * 6_000);
      log(`Spawning planner (timeout ${Math.round(killMs / 1000)}s)…`);

      const result = await new Promise<{ buf: string; code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        // stdin = /dev/null so the CLI doesn't wait 3s for piped input.
        const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        let buf = "";
        let firstByteAt = 0;
        const hb = setInterval(() => {
          log(`…running ${Math.round((Date.now() - t0) / 1000)}s · ${buf.length} chars received`);
        }, 4000);
        child.stdout.on("data", (d: Buffer) => {
          if (!firstByteAt) {
            firstByteAt = Date.now();
            log(`first output byte at ${Math.round((firstByteAt - t0) / 1000)}s`);
          }
          buf += d.toString();
        });
        child.stderr.on("data", (d: Buffer) => {
          const e = d.toString().trim();
          if (e) log(`stderr: ${e.slice(0, 160).replace(/\s+/g, " ")}`);
        });
        const killer = setTimeout(() => {
          log("TIMEOUT reached → SIGTERM");
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        }, killMs);
        child.on("close", (code, signal) => {
          clearTimeout(killer);
          clearInterval(hb);
          resolve({ buf, code, signal });
        });
        child.on("error", (e) => {
          clearTimeout(killer);
          clearInterval(hb);
          log(`spawn error: ${e.message}`);
          resolve({ buf, code: null, signal: null });
        });
      });

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
