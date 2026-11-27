import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import type { Page, Frame } from "playwright-core";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { dropNewTabs } from "./diagnose";
import { isSubmitControl, snapshotLabel } from "./submit-guard.mjs";
import { executeAction, factsOf, listedFieldLabel, snapshotChoiceLine } from "./drive-action.mjs";
import { listedDriveClick, listedDriveText } from "./blank-unknown.mjs";
import { driveGoalText } from "./drive-goal.mjs";
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

// unsupported: the page moved onto a refused host (Workday, iCIMS, UKG or
// apply.handoff_hosts); the drive stopped there and its window is closed.
export type DriveResult = { reached: boolean; turns: number; reason: string; steps: DriveStep[]; unsupported?: { vendor: string; label: string; postingUrl: string } };

/** Controls tagged per turn. The planner reads every one of them. */
const MAX_REFS = 70;

/** Ref-tagged snapshot of the interactive page (a browser_snapshot-style view the
 *  LLM reasons over). Tags data-co-ref on each element so actions are unambiguous.
 *  A submit control is listed WITHOUT a ref: the planner can see that it exists
 *  and stop, but it has no name for it, so no action can address it. `actionable`
 *  is the set of refs it may use, which every ref-bearing action is held to. */
async function snapshot(frame: Frame): Promise<{ text: string; actionable: Set<string>; controls: Map<string, { kind: string; label: string; group: string; question: string; option: string; identity: string }> }> {
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
  const controls = new Map<string, { kind: string; label: string; group: string; question: string; option: string; identity: string }>();
  if (!tagged) return { text: "", actionable, controls };
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
    controls.set(el.ref, { kind, label, group: el.group || "", question: el.question || "", option: el.option || "", identity: listedFieldLabel(el) });
    lines.push(snapshotChoiceLine(el.ref, kind, label, el.option || ""));
  }
  return { text: lines.join("\n"), actionable, controls };
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

type Action = {
  action: string;
  ref?: string;
  text?: string;
  value?: string;
  reason?: string;
  expected?: { label: string; group: string; question: string; option: string; identity: string };
  ensureChecked?: boolean;
};

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
  refused?: () => Promise<{ vendor: string; label: string; postingUrl: string } | null>,
): Promise<DriveResult> {
  const steps: DriveStep[] = [];
  // A page on a refused host is never driven: checked before the first step,
  // before each later one (the last action may have navigated), and at the end.
  const stopIfRefused = async (turns: number): Promise<DriveResult | null> => {
    const hit = await refused?.();
    return hit ? { reached: false, turns, reason: "unsupported", steps, unsupported: hit } : null;
  };
  const refusedAtStart = await stopIfRefused(0);
  if (refusedAtStart) return refusedAtStart;
  const resolved = resolveCli(cliId);
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
  const goalText = driveGoalText(goal, answers);
  let resumeId: string | null = null;

  const stopVerb = goal === "reach" ? '{"action":"reached_form"}            STOP — the fillable application form is now visible' : '{"action":"done"}                    STOP — every answer is filled (you NEVER submit; the human does)';
  for (let turn = 1; turn <= budget; turn++) {
    if (turn > 1) {
      const refusedNow = await stopIfRefused(turn - 1);
      if (refusedNow) return refusedNow;
    }
    if (goal === "reach" && (await isFormReady().catch(() => false))) return { reached: true, turns: turn - 1, reason: "form-reached", steps };
    await dropNewTabs(page); // any "Apply" link/popup navigates in OUR tab, not a new one
    const frame = page.mainFrame();
    const snap = await snapshot(frame).catch(() => ({ text: "", actionable: new Set<string>(), controls: new Map() }));
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
    // The page can move while the planner thinks: check it before acting on
    // the reply, or before a "stuck" or "done" reply ends the drive.
    const refusedAfterPlanning = await stopIfRefused(turn - 1);
    if (refusedAfterPlanning) return refusedAfterPlanning;
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

    // A prompt line does not stop the model. On a full fill, type and select may
    // enter only the answer listed for that field. Empty text clears a field.
    // A radio or checkbox click has to be that field's listed option. A button
    // or a link stays a click, so Next and Continue still work.
    const control = act.ref ? snap.controls.get(act.ref) : undefined;
    const fieldLabel = control?.kind === "radio" || control?.kind === "checkbox" ? control.group : control?.identity || control?.label;
    const optionLabel = control?.kind === "radio" || control?.kind === "checkbox" ? control.option || control.label : control?.label;
    const entered = act.action === "type" ? act.text : act.action === "select" ? act.value : undefined;
    const blockedClick = goal === "full" && act.action === "click" && !listedDriveClick(control?.kind, optionLabel, control?.group, answers);
    if (blockedClick || (goal === "full" && entered !== undefined && !listedDriveText(entered, answers, fieldLabel))) {
      const s: DriveStep = {
        turn,
        action: act.action,
        detail: "blocked an answer that was not listed",
        thumb: await shot(),
        note: "left blank",
      };
      steps.push(s);
      emit(s);
      continue;
    }

    // execute the action on OUR session — NEVER submit. The executor, and the
    // guard it applies to every action naming a ref, live in drive-action.mjs so
    // a test can drive them: nothing here acts on an element directly.
    if (control) act.expected = { label: control.label, group: control.group, question: control.question, option: control.option, identity: control.identity };
    // A click toggles a checkbox. A listed choice is checked instead, so a box
    // that is already on stays on. A button or a link stays a click.
    if (goal === "full" && act.action === "click" && (control?.kind === "radio" || control?.kind === "checkbox")) {
      act.ensureChecked = true;
    }
    const { detail, note, refusal } = await executeAction(page, frame, act, snap.actionable);
    await page.waitForTimeout(700);
    const s: DriveStep = { turn, action: act.action, detail, thumb: await shot(), note: note || undefined, refusal };
    steps.push(s);
    emit(s);
  }
  const refusedAtEnd = await stopIfRefused(budget);
  if (refusedAtEnd) return refusedAtEnd;
  return { reached: await isFormReady().catch(() => false), turns: budget, reason: "budget-exhausted", steps };
}
