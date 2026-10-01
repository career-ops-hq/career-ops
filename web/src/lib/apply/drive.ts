import type { Page, Frame } from "playwright-core";
import { resolveCli, type CliSpec } from "@/lib/clis";
import { spawnCli } from "@/lib/cli-spawn";
import { careerOpsRoot } from "@/lib/career-ops";
import { dropNewTabs } from "./diagnose";
import type { DriveStep } from "./issue";

export type { DriveStep };

// ─────────────────────────────────────────────────────────────────────────────
// AGENTIC DRIVE LOOP — the backend gets "as intelligent as Claude Code + Playwright":
// observe (ref-tagged snapshot) → the LLM picks ONE action → WE execute it on OUR
// headed session → observe again → adapt. We orchestrate the loop (CLI-agnostic in
// principle; Claude-first via --resume) and execute every action ourselves, so:
//   • NEVER-SUBMIT is by CONSTRUCTION — the action vocabulary has no "submit", and
//     we refuse to click any submit/apply-final control. The human submits.
//   • everything stays in OUR session (screenshots, handoff, the streamed UI).
// HYBRID = drive only until a fillable application form is reached, then hand back
// to deterministic fill+verify. FULL = keep driving (fill the fields too).
// ─────────────────────────────────────────────────────────────────────────────

export type DriveResult = { reached: boolean; turns: number; reason: string; steps: DriveStep[] };

const SUBMIT_RX = /\b(submit|send application|finish( application)?|complete application|apply (and|&) submit|enviar|finalizar)\b/i;

/** Ref-tagged snapshot of the interactive page (a browser_snapshot-style view the
 *  LLM reasons over). Tags data-co-ref on each element so actions are unambiguous. */
async function snapshot(frame: Frame): Promise<{ text: string; n: number }> {
  return frame.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return (el as HTMLElement).offsetParent !== null && r.width > 2 && r.height > 2;
    };
    const sel = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="combobox"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
    const els = Array.from(document.querySelectorAll(sel)).filter(vis);
    const lines: string[] = [];
    let n = 0;
    for (const el of els.slice(0, 70)) {
      const tag = el.tagName.toLowerCase();
      const itype = ((el as HTMLInputElement).type || "").toLowerCase();
      if (tag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(itype)) {
        // surface submit buttons in the snapshot as read-only context (not actionable)
      }
      const ref = `e${n}`;
      el.setAttribute("data-co-ref", ref);
      const role = el.getAttribute("role") || (tag === "a" ? "link" : tag);
      const base = clean(el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder || el.textContent || (el as HTMLInputElement).value || (el as HTMLInputElement).name);
      // Disambiguate twin controls. Multi-step forms routinely repeat a visible
      // label ("Full Name" on both step 1 and step 2, or a repeated "Email"
      // inside a confirmation block) and a snapshot line carries no page context,
      // so the planner could type an answer into the wrong ref. The live `name`/
      // `id` attributes are stable, unique per control, and already on the
      // element we tagged — surfacing them lets the planner tell two identical
      // labels apart without any selector guessing. Execution is unchanged: the
      // model still picks a ref, and we still resolve it via [data-co-ref].
      const nm = clean(el.getAttribute("name")).slice(0, 40);
      const idAttr = clean(el.id).slice(0, 40);
      // Skip a suffix that would only repeat the visible label back at the model.
      const extra = [
        nm && nm !== base ? `name: ${nm}` : "",
        idAttr && idAttr !== base ? `id: ${idAttr}` : "",
      ].filter(Boolean);
      const label = extra.length ? `${base} [${extra.join(", ")}]` : base;
      const kind = tag === "input" ? itype || "text" : tag === "a" ? "link" : tag === "select" ? "select" : tag === "textarea" ? "textarea" : role;
      lines.push(`[${ref}] ${kind} "${label}"`);
      n++;
    }
    return { text: lines.join("\n"), n };
  });
}

/**
 * One planner turn.
 *
 * CLI-agnostic: the argv and the stdout envelope both come from the resolved
 * CLI's `drive` capability (web/src/lib/clis.ts), so supporting a new planner —
 * a proxy, a local model — is a registry edit, not a branch here. `resumeId` is
 * passed through opaquely; a CLI without continuation ignores it.
 */
function plannerTurn(spec: CliSpec, binPath: string, prompt: string, resumeId: string | null): Promise<{ out: string; sessionId: string | null }> {
  const args = spec.drive!.args(prompt, resumeId);
  return new Promise((resolve) => {
    const child = spawnCli(binPath, args, { cwd: careerOpsRoot() });
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
      resolve(spec.drive!.parse(buf));
    });
    child.on("error", () => {
      clearTimeout(killer);
      resolve(spec.drive!.parse(buf));
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
  // Capability gate, not an id allowlist: a CLI drives forms when its spec
  // declares a `drive` transport (argv + stdout envelope). Adding a proxy or a
  // local model is then a registry edit in clis.ts, not a branch here.
  if (!resolved || !resolved.spec?.drive) {
    return {
      reached: false,
      turns: 0,
      reason: `${resolved?.spec?.name || cliId || "This CLI"} cannot drive forms yet — agentic drive needs a CLI with a browser-driving transport (Claude Code, OpenCode).`,
      steps,
    };
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
    const snap = await snapshot(frame).catch(() => ({ text: "", n: 0 }));
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

    const { out, sessionId } = await plannerTurn(resolved.spec, resolved.binPath, prompt, resumeId);
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
      const loc = act.ref ? frame.locator(`[data-co-ref="${act.ref}"]`).first() : null;
      if (act.action === "click" && loc) {
        const txt = (await loc.innerText().catch(() => "")) || (await loc.getAttribute("value").catch(() => "")) || "";
        if (SUBMIT_RX.test(txt)) {
          note = "refused to click a submit control (the human submits)";
          detail = `blocked submit "${txt.slice(0, 40)}"`;
        } else {
          detail = `click "${txt.slice(0, 40)}"`;
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {}), loc.click({ timeout: 6000 })]);
        }
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
