import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import type { Page, Frame } from "playwright-core";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { dropNewTabs } from "./diagnose";
import { isSubmitControl, snapshotLabel } from "./submit-guard.mjs";
import { executeAction, factsOf } from "./drive-action.mjs";
import type { DriveStep } from "./issue";
import { CAPS } from "../worker-capabilities.mjs";
import { scopeFrom } from "../claude-invocation.mjs";

export type { DriveStep };

// ─────────────────────────────────────────────────────────────────────────────
// AGENTIC DRIVE LOOP — the backend gets "as intelligent as Claude Code + Playwright":
// observe (ref-tagged snapshot) → the LLM picks ONE action → WE execute it on OUR
// headed session → observe again → adapt. We orchestrate the loop (CLI-agnostic in
// principle; Claude-first via --resume) and execute every action ourselves, so:
//   • NEVER-SUBMIT is by CONSTRUCTION for the planner's action vocabulary — it has
//     no "submit", a submit/apply-final control is listed with no ref so it cannot
//     be named, and we re-check the element before every action that names one.
//     What this does NOT construct away: an allowed control's own click handler can
//     still call requestSubmit(). Closing that needs an interlock on the submit
//     event itself, not another DOM heuristic (see submit-guard.mjs's header). The
//     human submits every path this loop does cover.
//   • everything stays in OUR session (screenshots, handoff, the streamed UI).
// HYBRID = drive only until a fillable application form is reached, then hand back
// to deterministic fill+verify. FULL = keep driving (fill the fields too).
// ─────────────────────────────────────────────────────────────────────────────

export type DriveResult = { reached: boolean; turns: number; reason: string; steps: DriveStep[] };

/** Controls tagged per turn. The planner reads every one of them. */
const MAX_REFS = 70;

/** Ref-tagged snapshot of the interactive page (a browser_snapshot-style view the
 *  LLM reasons over). Tags data-co-ref on each element so actions are unambiguous.
 *  A submit control is listed WITHOUT a ref: the planner can see that it exists
 *  and stop, but it has no name for it, so no action can address it. `actionable`
 *  is the set of refs it may use, which every ref-bearing action is held to. */
async function snapshot(frame: Frame): Promise<{ text: string; actionable: Set<string> }> {
  // A fresh prefix per snapshot. The guarantee is structural, not statistical:
  // every existing `data-co-ref` is stripped before this turn's are written, so
  // only the current epoch's refs exist on the page, and `actionable` is built
  // from that same pass. A ref from the previous turn names an attribute that no
  // longer exists anywhere, so neither the actionable check nor the selector can
  // find it. Numbering from e0 each turn would hand the same name to a different
  // element across turns, and both lookups would have accepted it.
  const epoch = `e${Math.random().toString(36).slice(2, 8)}`;
  const tagged = await frame.evaluate(
    ({ prefix, max }) => {
      for (const stale of Array.from(document.querySelectorAll("[data-co-ref]"))) stale.removeAttribute("data-co-ref");
      const vis = (el: Element) => {
        const r = el.getBoundingClientRect();
        return (el as HTMLElement).offsetParent !== null && r.width > 2 && r.height > 2;
      };
      const sel = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="combobox"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
      const els = Array.from(document.querySelectorAll(sel)).filter(vis);
      let n = 0;
      for (const el of els.slice(0, max)) el.setAttribute("data-co-ref", `${prefix}-${n++}`);
      return n;
    },
    { prefix: epoch, max: MAX_REFS },
  );
  const lines: string[] = [];
  const actionable = new Set<string>();
  if (!tagged) return { text: "", actionable };
  // One handle per candidate, read through the same extractor the action path
  // uses. Handles rather than one `$$eval` so there is a single copy of the
  // rule; the reads are issued together and the handles released straight after.
  const handles = await frame.$$(`[data-co-ref^="${epoch}-"]`);
  const els = await Promise.all(handles.map((h) => h.evaluate(factsOf, null).catch(() => null)));
  await Promise.all(handles.map((h) => h.dispose().catch(() => {})));
  for (const el of els) {
    if (!el || !el.ref) continue;
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
  return { text: lines.join("\n"), actionable };
}

// The narrowest scope in the app. scopeFrom("") grants nothing, so every
// write-capable and network tool is denied BY DERIVATION; Read, Glob and Grep are
// denied on top so the planner reasons over the snapshot it was handed and
// nothing else. Derived rather than hand-listed for the reason agent-interpret.ts
// gives (#2185): a tool added to WRITE_CAPABLE_TOOLS or NETWORK_TOOLS must not
// leave this argv silently permissive — and verifyClaudeArgs would refuse the
// spawn the moment the hand-written copy fell behind.
const PLANNER_DENIED = [scopeFrom("").disallowed, "Read", "Glob", "Grep"].join(",");

/** One planner turn (Claude-first: --resume keeps the loop's context cheaply). */
function plannerTurn(binPath: string, prompt: string, resumeId: string | null): Promise<{ out: string; sessionId: string | null }> {
  const base = resumeId ? ["-p", "--resume", resumeId, prompt] : ["-p", prompt];
  const args = [...base, "--output-format", "json", "--strict-mcp-config", "--disallowedTools", PLANNER_DENIED];
  return new Promise((resolve) => {
    // Claude-only by construction — driveSession returns before the loop unless
    // cliId is "claude", and this argv is Claude's own (--resume, --output-format
    // json). That is why there is deliberately no unfenced notice here, unlike the
    // other CLI-spawning paths: claude is always fenceable, so the check could
    // never fire and the branch would be dead code (#2507). The narrowest scope in
    // the app: the disallowedTools above denies every tool including Read, so the
    // planner reasons over the snapshot it was handed and nothing else.
    const child = spawnHeadlessCli(
      binPath,
      args,
      { cwd: careerOpsRoot(), env: process.env },
      { cliId: "claude", capabilities: CAPS.localReadOnly },
    );
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

  const stopVerb = goal === "reach" ? '{"action":"reached_form"}            STOP — the fillable application form is now visible' : '{"action":"done"}                    STOP — every answer is filled (you NEVER submit; the human does)';
  for (let turn = 1; turn <= budget; turn++) {
    if (goal === "reach" && (await isFormReady().catch(() => false))) return { reached: true, turns: turn - 1, reason: "form-reached", steps };
    await dropNewTabs(page); // any "Apply" link/popup navigates in OUR tab, not a new one
    const frame = page.mainFrame();
    const snap = await snapshot(frame).catch(() => ({ text: "", actionable: new Set<string>() }));
    const prompt =
      turn === 1
        ? `You are an agent driving a real web browser for a job seeker (we execute your actions; the human submits at the end). ${goalText}
You NEVER submit a form — there is no submit action; the human does that.
Reply with EXACTLY ONE action as a JSON object, nothing else:
  {"action":"click","ref":"<ref>"}         click an element (refs are the bracketed names below, and they change every turn)
  {"action":"type","ref":"<ref>","text":"…"}  type into a field
  {"action":"select","ref":"<ref>","value":"…"} pick an option
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

    // execute the action on OUR session — NEVER submit. The executor, and the
    // guard it applies to every action naming a ref, live in drive-action.mjs so
    // a test can drive them: nothing here acts on an element directly.
    const { detail, note, refusal } = await executeAction(page, frame, act, snap.actionable);
    await page.waitForTimeout(700);
    const s: DriveStep = { turn, action: act.action, detail, thumb: await shot(), note: note || undefined, refusal };
    steps.push(s);
    emit(s);
  }
  return { reached: await isFormReady().catch(() => false), turns: budget, reason: "budget-exhausted", steps };
}
