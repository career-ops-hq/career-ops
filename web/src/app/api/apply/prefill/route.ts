import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { getSession } from "@/lib/apply/session";
import * as yaml from "js-yaml";
import type { ApplyField } from "@/lib/apply/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

type DraftAnswer = { value: string; needs_confirmation: boolean };

function localOllama(): { binPath: string; model: string } | null {
  if (process.env.JOB_TRACKING_USE_OLLAMA !== "1") return null;
  const candidates = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"];
  const binPath = candidates.find((candidate) => fs.existsSync(candidate));
  return binPath ? { binPath, model: process.env.JOB_TRACKING_OLLAMA_MODEL?.trim() || "qwen2.5:14b" } : null;
}

function option(field: ApplyField, wanted: RegExp): string {
  return field.options?.find((value) => wanted.test(value)) ?? "";
}

/** Fill facts we already own without waiting for an AI planner. */
function knownAnswers(fields: ApplyField[], formTitle: string): Record<string, DraftAnswer> {
  let profile: Record<string, any> = {};
  let answerBank: Record<string, any> = {};
  try {
    profile = (yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "config", "profile.yml"), "utf8")) as Record<string, any>) || {};
  } catch {
    /* the AI path can still provide answers */
  }
  try {
    answerBank = (yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "data", "application-answers.yml"), "utf8")) as Record<string, any>) || {};
  } catch {
    /* saved answer suggestions are optional */
  }
  const candidate = profile.candidate || {};
  const location = profile.location || {};
  const common = answerBank.common || {};
  const companyKey = Object.keys(answerBank.companies || {}).find((key) => formTitle.toLowerCase().includes(key.toLowerCase()));
  const companyAnswers = companyKey ? answerBank.companies[companyKey] || {} : {};
  const fullName = String(candidate.full_name || "").trim();
  const names = fullName.split(/\s+/);
  const firstName = names.shift() || "";
  const lastName = names.join(" ");
  const out: Record<string, DraftAnswer> = {};

  for (const field of fields) {
    const label = `${field.label} ${field.nativeName || ""}`.toLowerCase();
    let value = "";
    let confirm = false;
    if (/first.?name|given.?name/.test(label)) value = firstName;
    else if (/last.?name|family.?name|surname/.test(label)) value = lastName;
    else if (/full.?name|legal.?name/.test(label)) value = fullName;
    else if (/e.?mail/.test(label)) value = String(candidate.email || "");
    else if (/phone|mobile/.test(label) && !/country/.test(label)) value = String(candidate.phone || "");
    else if (/linkedin/.test(label)) value = String(candidate.linkedin || "");
    else if (/github/.test(label)) value = String(candidate.github || "");
    else if (/portfolio|website|personal.?site/.test(label)) value = String(candidate.portfolio_url || "");
    else if (/current company|current employer/.test(label)) value = String(common.current_company || "");
    else if (/preferred name|what would you like us to call you/.test(label)) value = String(common.preferred_name || "");
    else if (/name pronunciation|pronounce your name/.test(label)) value = String(common.name_pronunciation || "");
    else if (/\bcountry\b/.test(label)) value = option(field, /^(united kingdom|uk)$/i) || String(location.country || "");
    else if (/\bcity\b|current location|where.*based|address.*working/.test(label)) value = String(location.city || candidate.location || "");
    else if (/currently.*(based|living).*uk|based.*united kingdom/.test(label)) value = option(field, /^yes\b/i) || "Yes";
    else if (/\bschool\b|university|institution/.test(label)) value = String(common.school || "");
    else if (/\bdegree\b|qualification/.test(label)) value = option(field, /master|msc/i) || String(common.degree || "");
    else if (/discipline|field of study|subject/.test(label)) value = option(field, /computer science/i) || String(common.discipline || "");
    else if (/end date year|graduation year/.test(label)) value = option(field, new RegExp(`^${String(common.graduation_year || "")}$`)) || String(common.graduation_year || "");
    else if (/how did you hear|heard about this opportunity|source/.test(label)) {
      value = option(field, /company (career|website)|career site|company site/i) || String(common.heard_about_role || "");
    }
    else if (/favorite project|favourite project|proudest accomplishment|proudest achievement/.test(label)) value = String(companyAnswers.proudest_accomplishment || "");
    else if (/why.*(palantir|company|work here)|why do you want/.test(label)) value = String(companyAnswers.why_company || "");
    else if (/additional information|anything else/.test(label)) value = String(companyAnswers.additional_information || "");
    else if (/^english\s*\(eng\)/.test(label) && field.type === "checkbox") value = "true";
    else if (/^cards\[|future job opportunities|consent to contact/.test(label)) confirm = true;
    else if (/salary|compensation|notice period|visa|sponsor|work authori[sz]ation|demographic|gender|ethnic|disability|veteran/.test(label)) confirm = true;
    if (value || confirm) out[field.id] = { value, needs_confirmation: confirm };
  }
  return out;
}

/**
 * Pull a JSON object out of an LLM's text answer, tolerating code fences,
 * trailing prose, and — crucially — TRUNCATION (the planner getting killed
 * mid-output on a big form). When the object is incomplete we salvage the
 * largest valid prefix so the fields that DID finish still come through.
 */
function extractJsonObject(text: string): { obj: Record<string, unknown> | null; truncated: boolean } {
  // Ollama's CLI may emit cursor/show-hide and colour sequences when it thinks
  // stdout is interactive. They are presentation bytes, never model content.
  const s = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "").replace(/```(?:json)?/gi, "");
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
  let body: { sessionId?: string; cliId?: string; fieldId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { sessionId, cliId, fieldId } = body;
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
      const requestedFields = fieldId ? s.fields.filter((field) => field.id === fieldId) : s.fields;
      if (fieldId && requestedFields.length === 0) return fail("application field not found");
      const saved = knownAnswers(requestedFields, s.title);
      const resolved = cliId ? resolveCli(cliId) : null;
      const ollama = !resolved ? localOllama() : null;
      // Known single-field answers come straight from the local answer bank:
      // no reason to start a model and make an "instant" suggestion wait.
      if (!resolved && (!fieldId || !ollama || saved[fieldId]?.value)) {
        const count = Object.keys(saved).length;
        log(`Filled ${count} saved profile/CV answers${ollama ? " instantly" : " (AI planner unavailable)"}`);
        emit({ t: "done", answers: saved, truncated: false, count });
        controller.close();
        return;
      }
      const binPath = resolved?.binPath || ollama!.binPath;

      const fieldsList = requestedFields
        .map((f) => `${f.id}\t${f.type}${f.required ? "*" : ""}\t${f.label}${f.options ? `\t[options: ${f.options.join(" | ")}]` : ""}`)
        .join("\n");
      const mem = readMemory().trim();
      const localContext = ollama
        ? `\n\nCANDIDATE CV:\n${fs.readFileSync(path.join(careerOpsRoot(), "cv.md"), "utf8")}\n\nCANDIDATE PROFILE:\n${fs.readFileSync(path.join(careerOpsRoot(), "config", "profile.yml"), "utf8")}`
        : "";
      const prompt = `You are pre-filling a job application for the user (company/role: ${s.title}). ${ollama ? "Use the candidate context included below." : "Read cv.md and config/profile.yml; if a matching report for this company exists in reports/, read it too."} Ground EVERY answer in the REAL candidate — never invent facts.${mem ? `\n\nDurable notes about the user:\n${mem}` : ""}${localContext}

FIELDS (id ⇥ type ⇥ label ⇥ options):
${fieldsList}

For each field give the best answer:
- identity/contact (name, email, phone, github, linkedin, location) → from profile/cv.
- free-text (Why us?, cover-letter, "most impactful thing you've built", etc.) → a concise, honest, concrete answer in the candidate's own voice (no buzzwords, active voice, real metrics only). Keep each under ~120 words.
- select/radio → choose the best-matching option using the EXACT option text from the list.
- NEVER fill legal / visa / work-authorization / salary / demographic / sensitive fields → set needs_confirmation:true and value:"".

Output ONLY a compact JSON object mapping each field id → {"value": "...", "needs_confirmation": boolean}. No prose, no markdown, no code fence.`;

      log(`Form: "${s.title}" · ${requestedFields.length} fields · prompt ${prompt.length} chars · memory ${mem.length} chars`);
      log(`Planner: ${resolved ? cliId : `Ollama ${ollama!.model}`} (${binPath})`);

      const isClaude = cliId === "claude";
      // --strict-mcp-config with no --mcp-config = load ZERO MCP servers → much
      // faster startup (skips the user's global playwright/gmail/linear/… servers
      // the planner doesn't need; it only reads local files).
      const args = ollama
        ? ["run", ollama.model, prompt, "--format", "json", "--hidethinking", "--nowordwrap"]
        : isClaude
        ? ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", "Read,Glob,Grep", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch"]
        : resolved!.spec.args(prompt);
      // Scale the timeout with form size (big forms = more drafting). Cap < maxDuration.
      const killMs = Math.min(300_000, 150_000 + requestedFields.length * 6_000);
      log(`Spawning planner (timeout ${Math.round(killMs / 1000)}s)…`);

      const result = await new Promise<{ buf: string; code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        // spawnHeadlessCli closes stdin right after spawning, so the CLI doesn't
        // wait on piped input that will never arrive.
        const child = spawnHeadlessCli(binPath, args, {
          cwd: careerOpsRoot(),
          env: ollama ? { ...process.env, TERM: "dumb", NO_COLOR: "1", OLLAMA_NOHISTORY: "1" } : process.env,
        });
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
      const merged = { ...(obj as Record<string, DraftAnswer>), ...saved };
      const count = Object.keys(merged).length;
      log(`Parsed ${count} answers${truncated ? " (RECOVERED from truncated output — some fields may be missing)" : ""}`);
      emit({ t: "done", answers: merged, truncated, count });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
