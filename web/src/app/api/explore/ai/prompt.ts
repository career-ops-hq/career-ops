import fs from "node:fs";
import path from "node:path";
import { resolveCodeRoot } from "../../../../lib/core/code-root.mjs";

export const AI_SEARCH_MODE_FILE = "web-search.md";

const OUTPUT_CONTRACT = `

--- OUTPUT CONTRACT (the career-ops WEB is parsing your stream) ---
Follow the dedicated web-search mode above exactly. You are running headless for the web:
- You are a PROPOSER — never write a file (Write/Edit/Bash are disabled).
- Emit each candidate as ONE line, never inside a code fence:
  <<offer:{"url":"…","title":"…","company":"…","location":"…","source":"ai-search","why":"…","postedHint":"…","ats":"…","verification":"unconfirmed"}>>
  Valid JSON, one per line, the moment you're confident — stream them as you go.
- Between envelopes, narrate briefly (plain text) what you're searching — shown live as your reasoning.
- Be frugal (~3–6 searches, stop at a strong set). EVERY candidate is UNVERIFIED.
- Be a GENEROUS FINDER, not a judge: when a constraint (location, seniority, stage) can't be confirmed from the shallow signal, INCLUDE + flag the uncertainty in "why" — don't discard. NEVER score or judge fit; the A–F evaluation does that later, with the full JD.
- DEDUP: skip anything already known below; don't re-propose the user's existing companies.
`;

export function buildAiSearchPrompt({ root, cwd = process.cwd(), env = process.env, query, memory = "", knownLines = [] }: {
  root?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  query: string;
  memory?: string;
  knownLines?: string[];
}): string {
  const mode = fs.readFileSync(path.join(root ?? resolveCodeRoot(cwd, env), "modes", AI_SEARCH_MODE_FILE), "utf8");
  const memoryLine = memory.trim() ? `\n\nWHAT YOU KNOW ABOUT THE USER (persistent memory):\n${memory.trim()}` : "";
  const knownBlock = knownLines.length ? `\n\n--- ALREADY KNOWN (dedup — do NOT propose these) ---\n${knownLines.join("\n")}` : "";
  return `${mode}${OUTPUT_CONTRACT}${memoryLine}${knownBlock}\n\n--- USER INTENT ---\n${query}\n`;
}
