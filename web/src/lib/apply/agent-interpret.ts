import { spawn } from "node:child_process";
import type { Frame } from "playwright-core";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import type { ApplyField } from "./extract";

// ─────────────────────────────────────────────────────────────────────────────
// AGENTIC FALLBACK — the AI interprets the LIVE form, like a human does with
// Playwright. When deterministic extraction is low-confidence (unknown ATS, 0
// clean fields), we hand the LLM a text snapshot of EVERY interactive control +
// its surrounding context/options (no hardcoded selectors), and it returns the
// form's structure. WE then actuate deterministically (fill/verify/handoff) —
// the LLM interprets, never blind-clicks. Robust to any markup change.
// ─────────────────────────────────────────────────────────────────────────────

type Cand = { n: number; tag: string; type: string; name: string; placeholder: string; aria: string; req: boolean; ctx: string; opts: string[] };

/** Tag + capture every interactive control in the frame as a browser_snapshot-style
 *  text list the LLM can reason over. Radio groups collapse to one candidate. */
async function captureCandidates(frame: Frame): Promise<Cand[]> {
  return frame.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const cands: Cand[] = [];
    const seenRadio = new Set<string>();
    const els = Array.from(document.querySelectorAll('input, textarea, select, [role="combobox"], [role="radiogroup"], [contenteditable="true"]'));
    let n = 0;
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const itype = ((el as HTMLInputElement).type || "").toLowerCase();
      const role = el.getAttribute("role") || "";
      if (tag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(itype)) continue;
      if ((el as HTMLElement).offsetParent === null && itype !== "radio" && itype !== "checkbox") continue;
      if ((el as Element).closest('[class*="autofill" i]')) continue;

      const cont = el.closest('[class*="field" i], [class*="question" i], fieldset, .form-group, div');
      const ctx = clean((cont as HTMLElement | null)?.innerText);
      const req = (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true" || /\*|\brequired\b/i.test(ctx);
      const name = (el as HTMLInputElement).name || (el as HTMLElement).id || "";
      const aria = el.getAttribute("aria-label") || "";
      const placeholder = (el as HTMLInputElement).placeholder || "";

      if (itype === "radio") {
        const rname = (el as HTMLInputElement).name;
        if (rname && seenRadio.has(rname)) continue;
        if (rname) seenRadio.add(rname);
        const group = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(rname)}"]`));
        const opts = group.map((r) => clean((document.querySelector(`label[for="${CSS.escape((r as HTMLElement).id)}"]`)?.textContent) || r.closest("label")?.textContent || (r as HTMLInputElement).value)).filter(Boolean);
        group.forEach((r) => r.setAttribute("data-co-cand", String(n)));
        cands.push({ n, tag: "radiogroup", type: "radio", name: rname || "", placeholder, aria, req, ctx, opts });
        n++;
        continue;
      }
      el.setAttribute("data-co-cand", String(n));
      let opts: string[] = [];
      if (tag === "select") opts = Array.from((el as HTMLSelectElement).options).map((o) => clean(o.textContent)).filter((o) => o && !/^(select|choose|--)/i.test(o));
      cands.push({ n, tag, type: itype || role || tag, name, placeholder, aria, req, ctx, opts });
      n++;
    }
    return cands;
  });
}

const VALID_TYPES = new Set(["text", "email", "tel", "url", "number", "date", "textarea", "select", "radio", "checkbox", "file"]);

/** Ask the planner CLI to interpret the captured controls into clean fields. */
function buildPrompt(title: string, cands: Cand[]): string {
  const lines = cands
    .map((c) => `[${c.n}] tag=${c.tag} type=${c.type}${c.req ? " required" : ""}${c.name ? ` name="${c.name}"` : ""}${c.placeholder ? ` placeholder="${c.placeholder}"` : ""}${c.aria ? ` aria="${c.aria}"` : ""}${c.opts.length ? ` options=[${c.opts.slice(0, 12).join(" | ")}]` : ""} | context: "${c.ctx}"`)
    .join("\n");
  return `You are interpreting a LIVE job-application form (${title}) so it can be re-rendered cleanly. Below is EVERY interactive control with its surrounding text. For EACH control decide:
- "skip": true if it is NOT a real application field to fill (a search/filter box, navigation, cookie/consent control, social-login button, or decorative widget).
- otherwise give: "label" (the human question in plain words, cleaned of asterisks/option text), "type" (one of: text, email, tel, url, number, date, textarea, select, radio, checkbox, file), "options" (ONLY for select/radio — the exact visible option texts), "required" (boolean).
Infer the TYPE from meaning (e.g. a "Resume/CV" upload = file; a custom dropdown = select; "Why us?" = textarea). Use the EXACT option texts shown.

CONTROLS:
${lines}

Return ONLY a JSON array, no prose, no code fence:
[{"n":0,"skip":false,"label":"First Name","type":"text","options":[],"required":true}, ...]`;
}

function runPlanner(binPath: string, isClaude: boolean, argsFor: (p: string) => string[], prompt: string): Promise<string> {
  const args = isClaude ? ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", "Read", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch"] : argsFor(prompt);
  return new Promise((resolve) => {
    const child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    child.stdout.on("data", (d: Buffer) => (buf += d.toString()));
    child.stderr.on("data", () => {});
    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 150_000);
    child.on("close", () => {
      clearTimeout(killer);
      resolve(buf);
    });
    child.on("error", () => {
      clearTimeout(killer);
      resolve(buf);
    });
  });
}

type Interpreted = { n: number; skip?: boolean; label?: string; type?: string; options?: string[]; required?: boolean };

/** The agentic interpreter: capture the live form, let the LLM read+classify it,
 *  re-tag the chosen controls with data-co-field, and return clean ApplyField[].
 *  Returns [] if the CLI is missing or interpretation fails (caller falls back). */
export async function agentInterpretForm(frame: Frame, cliId: string, title: string): Promise<ApplyField[]> {
  const resolved = resolveCli(cliId);
  if (!resolved) return [];
  const cands = await captureCandidates(frame).catch(() => [] as Cand[]);
  if (!cands.length) return [];

  const out = await runPlanner(resolved.binPath, cliId === "claude", resolved.spec.args, buildPrompt(title, cands));
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let parsed: Interpreted[];
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }

  const byN = new Map(cands.map((c) => [c.n, c]));
  const fields: ApplyField[] = [];
  const tagMap: { candN: number; fid: string; type: string; options: string[] }[] = [];
  parsed
    .filter((p) => p && !p.skip && typeof p.n === "number" && byN.has(p.n))
    .forEach((p) => {
      const type = VALID_TYPES.has(p.type || "") ? (p.type as ApplyField["type"]) : "text";
      const fid = `co${fields.length}`;
      const cand = byN.get(p.n)!;
      const options = (p.options && p.options.length ? p.options : cand.opts).map((s) => s.trim()).filter(Boolean);
      fields.push({ id: fid, type, label: (p.label || cand.ctx || "").slice(0, 160), required: !!p.required || cand.req, options: options.length ? options : undefined, combobox: type === "select" && cand.tag !== "select" });
      tagMap.push({ candN: p.n, fid, type, options });
    });
  if (!fields.length) return [];

  // Re-tag the live elements: data-co-field on the chosen control (+ per-option
  // data-co-option for radios) so fillSession can locate them deterministically.
  await frame
    .evaluate((tagMap) => {
      for (const t of tagMap) {
        const els = Array.from(document.querySelectorAll(`[data-co-cand="${t.candN}"]`));
        if (t.type === "radio") {
          els.forEach((r, i) => {
            r.setAttribute("data-co-field", t.fid);
            const lbl = (document.querySelector(`label[for="${CSS.escape((r as HTMLElement).id)}"]`)?.textContent || r.closest("label")?.textContent || (r as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
            r.setAttribute("data-co-option", t.options[i] || lbl || String(i));
          });
        } else {
          els.forEach((e) => e.setAttribute("data-co-field", t.fid));
        }
      }
    }, tagMap)
    .catch(() => {});

  return fields;
}
