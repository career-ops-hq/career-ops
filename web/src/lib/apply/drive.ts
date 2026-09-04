import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import type { Page, Frame } from "playwright-core";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { dropNewTabs } from "./diagnose";
import { isSubmitControl, snapshotLabel } from "./submit-guard.mjs";
import type { DriveStep } from "./issue";

export type { DriveStep };

// ─────────────────────────────────────────────────────────────────────────────
// AGENTIC DRIVE LOOP — the backend gets "as intelligent as Claude Code + Playwright":
// observe (ref-tagged snapshot) → the LLM picks ONE action → WE execute it on OUR
// headed session → observe again → adapt. We orchestrate the loop (CLI-agnostic in
// principle; Claude-first via --resume) and execute every action ourselves, so:
//   • NEVER-SUBMIT is by CONSTRUCTION — the action vocabulary has no "submit", a
//     submit/apply-final control is listed with no ref so it cannot be named, and
//     we re-check the element before every action that names one. The human submits.
//   • everything stays in OUR session (screenshots, handoff, the streamed UI).
// HYBRID = drive only until a fillable application form is reached, then hand back
// to deterministic fill+verify. FULL = keep driving (fill the fields too).
// ─────────────────────────────────────────────────────────────────────────────

export type DriveResult = { reached: boolean; turns: number; reason: string; steps: DriveStep[] };

/** What the guard decides on, read from the live DOM. See submit-guard.mjs. */
type ElementFacts = {
  ref: string;
  tag: string;
  type: string;
  explicitType: boolean;
  role: string;
  inForm: boolean;
  aria: string;
  placeholder: string;
  text: string;
  value: string;
  name: string;
};

/** Read element facts in the page. With no ref this is the snapshot pass: it tags
 *  every visible candidate with data-co-ref and returns them all. With a ref it
 *  re-reads that one element for the action guard. One extractor for both on
 *  purpose — two would eventually disagree, and the disagreement is the bug. */
async function readFacts(frame: Frame, ref: string | null): Promise<ElementFacts[]> {
  return frame.evaluate((targetRef) => {
    const facts = (el: Element, r: string) => {
      const tag = el.tagName.toLowerCase();
      const field = el as HTMLInputElement;
      const type = (el.getAttribute("type") || "").toLowerCase();
      return {
        ref: r,
        tag,
        type,
        // A <button> honours only these; anything else submits by default.
        explicitType: tag === "button" ? ["submit", "reset", "button"].includes(type) : type !== "",
        role: el.getAttribute("role") || (tag === "a" ? "link" : tag),
        // `.form` also covers a control placed outside its form by form="id".
        inForm: Boolean(field.form) || el.closest("form") !== null,
        aria: el.getAttribute("aria-label") || "",
        placeholder: field.placeholder || "",
        // Capped here, not in Node: a [role="button"] can wrap a whole section,
        // and 70 of those would cross the wire in full every turn. Well above
        // the 80 chars snapshotLabel keeps, so the cap decides nothing.
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
        value: field.value || "",
        name: field.name || "",
      };
    };
    if (targetRef !== null) {
      const el = document.querySelector(`[data-co-ref="${targetRef}"]`);
      return el ? [facts(el, targetRef)] : [];
    }
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return (el as HTMLElement).offsetParent !== null && r.width > 2 && r.height > 2;
    };
    const sel = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="combobox"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
    const els = Array.from(document.querySelectorAll(sel)).filter(vis);
    const out = [];
    let n = 0;
    for (const el of els.slice(0, 70)) {
      const ref = `e${n++}`;
      el.setAttribute("data-co-ref", ref);
      out.push(facts(el, ref));
    }
    return out;
  }, ref);
}

/** Ref-tagged snapshot of the interactive page (a browser_snapshot-style view the
 *  LLM reasons over). Tags data-co-ref on each element so actions are unambiguous.
 *  A submit control is listed WITHOUT a ref: the planner can see that it exists
 *  and stop, but it has no name for it, so no action can address it. `actionable`
 *  is the set of refs it may use, which every ref-bearing action is held to. */
async function snapshot(frame: Frame): Promise<{ text: string; n: number; actionable: Set<string> }> {
  const els = await readFacts(frame, null);
  const lines: string[] = [];
  const actionable = new Set<string>();
  for (const el of els) {
    if (el.tag === "input" && el.type === "hidden") continue;
    const label = snapshotLabel(el);
    if (isSubmitControl(el)) {
      lines.push(`[--] submit "${label}" (not actionable, the human submits)`);
      continue;
    }
    actionable.add(el.ref);
    const kind = el.tag === "input" ? el.type || "text" : el.tag === "a" ? "link" : el.tag === "select" ? "select" : el.tag === "textarea" ? "textarea" : el.role;
    lines.push(`[${el.ref}] ${kind} "${label}"`);
  }
  return { text: lines.join("\n"), n: actionable.size, actionable };
}

/** One planner turn (Claude-first: --resume keeps the loop's context cheaply). */
function plannerTurn(binPath: string, prompt: string, resumeId: string | null): Promise<{ out: string; sessionId: string | null }> {
  const base = resumeId ? ["-p", "--resume", resumeId, prompt] : ["-p", prompt];
  const args = [...base, "--output-format", "json", "--strict-mcp-config", "--disallowedTools", "Bash,Read,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Glob,Grep"];
  return new Promise((resolve) => {
    const child = spawnHeadlessCli(binPath, args, { cwd: careerOpsRoot(), env: process.env });
    let buf = "";
    child.stdout.on("data", (d: Buffer) => (buf += d.toString()));
    child.stderr.on("data", () => {});
    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 90_000);
    child.on("close", () => {
      clearTimeout(killer);
      let out = buf;
      let sessionId: string | null = null;
      try {
        const j = JSON.parse(buf);
        out = j.result ?? buf;
        sessionId = j.session_id ?? null;
      } catch {
        /* non-json (other CLI) → use raw */
      }
      resolve({ out, sessionId });
    });
    child.on("error", () => {
      clearTimeout(killer);
      resolve({ out: buf, sessionId: null });
    });
  });
}

type Action = { action: string; ref?: string; text?: string; value?: string; reason?: string };

function parseAction(out: string): Action | null {
  const m = out.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Drive the page agentically toward the application form (hybrid) or through it
 *  (full). `isFormReady` lets the caller stop the loop the moment a fillable form
 *  appears (hybrid hand-back). `emit` streams each step to the UI. */
export async function driveSession(
  page: Page,
  cliId: string,
  goal: "reach" | "full",
  isFormReady: () => Promise<boolean>,
  emit: (s: DriveStep) => void,
  budget = 10,
  answers?: { label: string; value: string }[],
): Promise<DriveResult> {
  const resolved = resolveCli(cliId);
  const steps: DriveStep[] = [];
  if (!resolved || cliId !== "claude") {
    return { reached: false, turns: 0, reason: "Agentic drive currently needs Claude Code (browser-driving CLI).", steps };
  }
  const shot = async () => {
    try {
      return `data:image/jpeg;base64,${(await page.screenshot({ type: "jpeg", quality: 38 })).toString("base64")}`;
    } catch {
      return undefined;
    }
  };
  const answersBlock = (answers ?? []).filter((a) => a.value?.trim()).map((a) => `- "${a.label}": ${a.value.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  const goalText =
    goal === "reach"
      ? `Your goal: navigate to the actual fillable JOB APPLICATION form (click 'Apply', pass any interstitial/pre-screen, reach the page with the Name/Email/Resume fields). Do NOT fill anything yet. Reply {"action":"reached_form"} once the form with those fields is visible.`
      : `Your goal: FILL this job application with the candidate's answers below, matching each answer to its field by label, across all pages (click 'Next'/'Continue' between pages). Skip any field already correctly filled, and skip file-uploads (handled separately). NEVER submit — when everything is filled and you're on the final page, reply {"action":"done"}.
ANSWERS (match by the field's label):
${answersBlock || "(no answers provided — just reach/observe)"}`;
  let resumeId: string | null = null;
  let lastUrl = page.url();

  const stopVerb = goal === "reach" ? '{"action":"reached_form"}            STOP — the fillable application form is now visible' : '{"action":"done"}                    STOP — every answer is filled (you NEVER submit; the human does)';
  for (let turn = 1; turn <= budget; turn++) {
    if (goal === "reach" && (await isFormReady().catch(() => false))) return { reached: true, turns: turn - 1, reason: "form-reached", steps };
    await dropNewTabs(page); // any "Apply" link/popup navigates in OUR tab, not a new one
    const frame = page.mainFrame();
    const snap = await snapshot(frame).catch(() => ({ text: "", n: 0, actionable: new Set<string>() }));
    const prompt =
      turn === 1
        ? `You are an agent driving a real web browser for a job seeker (we execute your actions; the human submits at the end). ${goalText}
You NEVER submit a form — there is no submit action; the human does that.
Reply with EXACTLY ONE action as a JSON object, nothing else:
  {"action":"click","ref":"e3"}            click an element
  {"action":"type","ref":"e4","text":"…"}  type into a field
  {"action":"select","ref":"e9","value":"…"} pick an option
  {"action":"scroll"}                        scroll down to reveal more
  ${stopVerb}
  {"action":"stuck","reason":"…"}            you can't proceed (login/captcha/dead-end)

Page: "${await page.title().catch(() => "")}" (${page.url()})
Elements:
${snap.text}`
        : `New page state after your last action.
Page: "${await page.title().catch(() => "")}" (${page.url()})
Elements:
${snap.text}

Reply ONE action JSON.`;

    const { out, sessionId } = await plannerTurn(resolved.binPath, prompt, resumeId);
    if (sessionId) resumeId = sessionId;
    const act = parseAction(out);
    if (!act) {
      const s: DriveStep = { turn, action: "parse-error", detail: out.slice(0, 80), thumb: await shot() };
      steps.push(s);
      emit(s);
      continue;
    }

    if (act.action === "reached_form") return { reached: true, turns: turn, reason: "agent-reached", steps };
    if (act.action === "done") return { reached: true, turns: turn, reason: "agent-done", steps };
    if (act.action === "stuck") {
      const s: DriveStep = { turn, action: "stuck", detail: act.reason || "", thumb: await shot() };
      steps.push(s);
      emit(s);
      return { reached: false, turns: turn, reason: act.reason || "stuck", steps };
    }

    // execute the action on OUR session — NEVER submit.
    let detail = "";
    let note = "";
    try {
      // Every action naming a ref is cleared before it gets a locator, not just
      // click: a withheld submit control still carries its data-co-ref in the
      // page, and `fill()` on a button throws into a fallback that clicks. The
      // element is re-read here because the DOM can change between the snapshot
      // and now, and being unreadable counts as refused — an element we cannot
      // describe is one we cannot clear.
      const ref = act.ref !== undefined && snap.actionable.has(act.ref) ? act.ref : null;
      const [now] = ref !== null ? await readFacts(frame, ref).catch(() => []) : [];
      const label = now ? snapshotLabel(now) : "";
      const loc = ref !== null && now && !isSubmitControl(now) ? frame.locator(`[data-co-ref="${ref}"]`).first() : null;
      if (act.ref !== undefined && !loc) {
        note = "refused to click a submit control (the human submits)";
        detail = ref === null ? `blocked ref ${act.ref} (not offered)` : now ? `blocked submit "${label.slice(0, 40)}"` : `blocked ref ${act.ref} (gone)`;
      } else if (act.action === "click" && loc) {
        detail = `click "${label.slice(0, 40)}"`;
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {}), loc.click({ timeout: 6000 })]);
      } else if (act.action === "type" && loc) {
        detail = `type into ${act.ref}`;
        await loc.fill(act.text || "").catch(async () => {
          await loc.click();
          await page.keyboard.type(act.text || "");
        });
      } else if (act.action === "select" && loc) {
        detail = `select "${act.value}"`;
        await loc.selectOption({ label: act.value || "" }).catch(() => loc.selectOption(act.value || ""));
      } else if (act.action === "scroll") {
        detail = "scroll";
        await page.evaluate(() => window.scrollBy(0, 700)).catch(() => {});
      } else {
        detail = `unknown action ${act.action}`;
      }
    } catch (e) {
      detail = `${act.action} failed: ${e instanceof Error ? e.message.slice(0, 50) : "err"}`;
    }
    await page.waitForTimeout(700);
    const s: DriveStep = { turn, action: act.action, detail, thumb: await shot(), note: note || undefined };
    steps.push(s);
    emit(s);
    lastUrl = page.url();
    void lastUrl;
  }
  return { reached: await isFormReady().catch(() => false), turns: budget, reason: "budget-exhausted", steps };
}
