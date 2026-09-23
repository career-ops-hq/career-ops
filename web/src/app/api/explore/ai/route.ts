import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { assembleDedupContext } from "@/lib/core/discover";
import { streamAgentCli } from "@/lib/core/agent-cli-stream";

// AI search orchestrates modes/hunt.md (freeform open-web hunt) by running the
// USER'S configured CLI headless (CLI-agnostic, like the assistant). Web hunting
// is slow → generous budget. The agent is a PROPOSER: Write/Edit/Bash are
// disabled so it structurally cannot persist; the only writes happen when the
// user later ADDs a candidate.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const OUTPUT_CONTRACT = `

--- OUTPUT CONTRACT (the career-ops WEB is parsing your stream) ---
Follow modes/hunt.md exactly. You are running headless for the web:
- You are a PROPOSER — never write a file (Write/Edit/Bash are disabled).
- Emit each candidate as ONE line, never inside a code fence:
  <<offer:{"url":"…","title":"…","company":"…","location":"…","source":"ai-search","why":"…","postedHint":"…","ats":"…","verification":"unconfirmed"}>>
  Valid JSON, one per line, the moment you're confident — stream them as you go.
- Between envelopes, narrate briefly (plain text) what you're searching — shown live as your reasoning.
- Be frugal (~3–6 searches, stop at a strong set). EVERY candidate is UNVERIFIED.
- Be a GENEROUS FINDER, not a judge: when a constraint (location, seniority, stage) can't be confirmed from the shallow signal, INCLUDE + flag the uncertainty in "why" — don't discard. NEVER score or judge fit; the A–F evaluation does that later, with the full JD.
- DEDUP: skip anything already known below; don't re-propose the user's existing companies.
`;

const ALLOWED_TOOLS = ["Read", "WebFetch", "WebSearch", "Glob", "Grep"]; // WebSearch ADDED vs the read-only assistant
const DISALLOWED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit", "Task"]; // proposer-not-writer, by construction

export async function POST(req: Request) {
  let body: { query?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const query = (body.query || "").trim();
  const cliId = body.cliId;
  if (!query || !cliId) return Response.json({ error: "query and cliId required" }, { status: 400 });

  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' not found on this machine` }, { status: 404 });
  const { spec, binPath } = resolved;

  // Read the CANONICAL mode at request time — single source of truth, never a
  // homegrown prompt. Missing (older core) → graceful 400 so the Scan tab stays usable.
  let mode: string;
  try {
    mode = fs.readFileSync(path.join(careerOpsRoot(), "modes", "hunt.md"), "utf8");
  } catch {
    return Response.json({ code: "MODE_MISSING", error: "AI search needs a newer career-ops — update to enable it." }, { status: 400 });
  }

  const { lines } = assembleDedupContext();
  const memory = readMemory();
  const memoryLine = memory.trim() ? `\n\nWHAT YOU KNOW ABOUT THE USER (persistent memory):\n${memory.trim()}` : "";
  const knownBlock = lines.length ? `\n\n--- ALREADY KNOWN (dedup — do NOT propose these) ---\n${lines.join("\n")}` : "";
  const prompt = `${mode}${OUTPUT_CONTRACT}${memoryLine}${knownBlock}\n\n--- USER INTENT ---\n${query}\n`;

  const stream = streamAgentCli({ cliId, binPath, spec, prompt, allowedTools: ALLOWED_TOOLS, disallowedTools: DISALLOWED_TOOLS });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
