import { chromium, type Browser, type BrowserContext, type Page, type Frame, type Response } from "playwright-core";
import { extractForm, type ApplyField, type ExtractedForm } from "./extract";
import { parseGreenhouse, fetchGreenhouseSchema } from "./greenhouse";
import { statusBlock, dismissConsent, tryApplyTrigger, dropNewTabs, classifyEmpty, captchaWarning, multiStepInfo, verifyFill, type ApplyIssue } from "./diagnose";
import { agentInterpretForm } from "./agent-interpret";

/** The frame with the most interactive controls — where the agentic interpreter
 *  should look when deterministic extraction found nothing usable. */
async function richestControlFrame(page: Page): Promise<Frame> {
  let best = page.mainFrame();
  let bestN = -1;
  for (const fr of page.frames()) {
    const n = await fr.evaluate(() => document.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"]').length).catch(() => 0);
    if (n > bestN) {
      bestN = n;
      best = fr;
    }
  }
  return best;
}

/** Escape a value for use inside a double-quoted CSS attribute selector.
 *  Backslash FIRST, then quote — escaping only the quote would let a trailing
 *  backslash neutralize the closing quote (CodeQL js/incomplete-sanitization). */
function cssAttr(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Navigate resiliently: a transient nav error / slow ATS shouldn't fail the
 *  whole apply. Up to 3 attempts with backoff; returns the navigation Response
 *  (status/headers feed the cheap status-block check). */
async function gotoResilient(page: Page, url: string): Promise<Response | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
      return resp;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(800 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("could not open the page");
}

/** Distinguish a real APPLICATION form from a careers-listing / job-search form
 *  (a closed Greenhouse posting redirects to the board, whose keyword/department
 *  filters would otherwise look like a fillable form). */
function looksLikeApplicationForm(form: ExtractedForm): boolean {
  const fs = form.fields;
  if (fs.length === 0) return false;
  const lab = (f: ApplyField) => (f.label || "").toLowerCase();
  const hasFile = fs.some((f) => f.type === "file");
  const hasEmail = fs.some((f) => f.type === "email" || /e-?mail/.test(lab(f)));
  const hasAppish = fs.some((f) => /first name|last name|full name|resume|résumé|\bcv\b|cover letter|phone|linkedin|github|why |portfolio|sponsorship|relocat/.test(lab(f)));
  if (hasFile || hasEmail || hasAppish) return true; // clearly an application
  const allSearch = fs.every(
    (f) => /search|buscar|filtr|keyword|palabra|department|departa|office|oficina|location|ubicaci|remote|category|categor/.test(lab(f)) || /filter|search|keyword/.test((f.nativeId || "").toLowerCase()),
  );
  if (allSearch) return false; // a job-board search/filter form
  if (fs.length <= 3 && fs.every((f) => !f.required)) return false; // too sparse + all optional = not an app form
  return true;
}

/** ATS forms are often embedded in an <iframe> on a company career site
 *  (greenhouse/lever/smartrecruiters embeds), sometimes cross-origin — the main
 *  frame then has 0 fields. Extract from EVERY frame and keep the richest one. */
async function pickFormFrame(page: Page): Promise<{ frame: Frame; form: ExtractedForm }> {
  let best: { frame: Frame; form: ExtractedForm } = {
    frame: page.mainFrame(),
    form: { title: "", url: page.url(), fields: [] },
  };
  for (const fr of page.frames()) {
    try {
      const form = await extractForm(fr);
      if (form.fields.length > best.form.fields.length) best = { frame: fr, form };
    } catch {
      /* detached / cross-origin restriction → skip */
    }
  }
  // Prefer the main frame's title (the posting title) when an iframe won the form.
  if (best.frame !== page.mainFrame() && !best.form.title) best.form.title = await page.title().catch(() => best.form.title);
  return best;
}

/** Enrich generically-extracted fields with an ATS's published schema (clean
 *  labels, correct types, real options) — Greenhouse renders react-select
 *  widgets whose options aren't in the DOM. Matched by native id/name, then label. */
async function enrichFromAts(url: string, fields: ApplyField[]): Promise<void> {
  const gh = parseGreenhouse(url);
  if (!gh) return;
  const schema = await fetchGreenhouseSchema(gh.token, gh.jobId);
  if (!schema) return;
  for (const f of fields) {
    const hit =
      (f.nativeName && schema.get(f.nativeName)) ||
      (f.nativeId && schema.get(f.nativeId)) ||
      (f.label && schema.get(`label:${f.label.toLowerCase()}`));
    if (!hit) continue;
    if (hit.label) f.label = hit.label;
    if (hit.type) f.type = hit.type as ApplyField["type"];
    if (hit.options.length) f.options = hit.options;
    if (hit.required) f.required = true;
    if (hit.type === "select") f.combobox = true;
  }
}

// A persistent apply SESSION keeps one real-form page open (headed-but-off-screen)
// so we can: extract → (user verifies pre-filled answers) → FILL the real form →
// bringToFront() for the human to submit it themselves. Headed (channel:chrome) =
// the user's own Chrome on their residential IP (best ATS success); never submits.
type Session = { id: string; url: string; title: string; fields: ApplyField[]; context: BrowserContext; page: Page; frame: Frame; createdAt: number; formShot?: string };

declare global {
  // eslint-disable-next-line no-var
  var __coApplySessions: Map<string, Session> | undefined;
  // eslint-disable-next-line no-var
  var __coHeadedBrowser: Browser | undefined;
  // eslint-disable-next-line no-var
  var __coIdleTimer: ReturnType<typeof setTimeout> | undefined;
}
const SESSIONS: Map<string, Session> = (globalThis.__coApplySessions ??= new Map());

async function headedBrowser(): Promise<Browser> {
  const b = globalThis.__coHeadedBrowser;
  if (b && b.isConnected()) return b;
  let nb: Browser;
  try {
    nb = await chromium.launch({
      channel: "chrome",
      headless: false,
      args: ["--window-position=-3200,-3200", "--window-size=1280,940"], // off-screen during fill; moved on-screen at handoff
    });
  } catch {
    // No system Google Chrome → fall back to Playwright's bundled Chromium if
    // present; otherwise a clear, actionable error.
    try {
      nb = await chromium.launch({ headless: false, args: ["--window-position=-3200,-3200", "--window-size=1280,940"] });
    } catch {
      throw new Error("The apply feature needs Google Chrome. Install Chrome (or run: npx playwright install chromium) and try again.");
    }
  }
  globalThis.__coHeadedBrowser = nb;
  return nb;
}

/** Close the headed Chrome once no sessions have been active for a while, so we
 *  don't leak a browser process. Re-armed on every prune/close; cancelled on open. */
function scheduleIdleClose() {
  if (globalThis.__coIdleTimer) clearTimeout(globalThis.__coIdleTimer);
  globalThis.__coIdleTimer = setTimeout(() => {
    if (SESSIONS.size === 0) {
      const b = globalThis.__coHeadedBrowser;
      globalThis.__coHeadedBrowser = undefined;
      void b?.close().catch(() => {});
    }
  }, 5 * 60_000);
}

function prune() {
  const now = Date.now();
  for (const [id, s] of SESSIONS) if (now - s.createdAt > 15 * 60_000) void closeSession(id);
}

/** Bounded scroll pass to trigger lazy/virtualized forms that only render their
 *  fields once scrolled into view, then return to the top. */
async function nudgeScroll(page: Page): Promise<void> {
  for (let i = 1; i <= 3; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 1200).catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

export async function openSession(url: string, cliId?: string, forceAgent?: boolean, noApplyBtn?: boolean): Promise<{ id: string; title: string; fields: ApplyField[]; shots: string[]; issues: ApplyIssue[]; needsDrive?: boolean }> {
  prune();
  if (globalThis.__coIdleTimer) clearTimeout(globalThis.__coIdleTimer); // someone's active
  const browser = await headedBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(8000); // no single action hangs the whole open/fill
  const page = await context.newPage();
  const abort = async (msg: string): Promise<never> => {
    await context.close().catch(() => {});
    if (SESSIONS.size === 0) scheduleIdleClose();
    throw new Error(msg);
  };
  // Capture the real form as we read it → a "behind the scenes" progress strip
  // that proves we genuinely opened + parsed THEIR form (not magic). The last
  // shot doubles as a subtle blurred backdrop behind the clean proxy.
  const shots: string[] = [];
  const snap = async () => {
    try {
      const b = await page.screenshot({ type: "jpeg", quality: 42 });
      shots.push(`data:image/jpeg;base64,${b.toString("base64")}`);
    } catch {
      /* ignore */
    }
  };
  // 1) Navigate (resilient) → cheapest hard-block check on the Response status.
  const resp = await gotoResilient(page, url);
  await snap(); // first paint
  const sBlock = statusBlock(resp?.status(), resp ? resp.headers() : {});
  if (sBlock) return abort(sBlock.message);

  // 2) Clear any cookie/consent overlay that hides the form (never a hard block).
  const consentIssues = await dismissConsent(page);

  // 3) Wait for real form controls to render (SPA hydrate) in ANY frame (embedded
  //    forms), then settle. More reliable than a fixed sleep.
  const formSel = 'form input, form textarea, input[type=file], [role=combobox], [class*="application-form" i], #application_form';
  await Promise.race(page.frames().map((f) => f.waitForSelector(formSel, { timeout: 12_000 }).catch(() => null))).catch(() => {});
  await page.waitForTimeout(1200);
  await dropNewTabs(page); // make any "Apply" link/popup navigate in OUR tab
  await snap(); // settled

  // 4) Extract from the richest frame; if nothing yet, try (a) a scroll pass to
  //    trigger lazy/virtualized fields, then (b) clicking an "Apply" button (SPA;
  //    never a submit) — re-settling and re-extracting after each.
  let { frame, form } = await pickFormFrame(page);
  // "no usable form yet" = 0 fields OR only non-application fields (e.g. a search
  // box on a job-description page) — both should trigger the recovery, not just 0.
  if (!looksLikeApplicationForm(form)) {
    await nudgeScroll(page);
    await page.waitForTimeout(400);
    ({ frame, form } = await pickFormFrame(page));
  }
  if (!noApplyBtn && !looksLikeApplicationForm(form) && (await tryApplyTrigger(page))) {
    await Promise.race(page.frames().map((f) => f.waitForSelector(formSel, { timeout: 6_000 }).catch(() => null))).catch(() => {});
    await page.waitForTimeout(800);
    await dropNewTabs(page);
    ({ frame, form } = await pickFormFrame(page));
    await snap();
  }
  await enrichFromAts(url, form.fields); // clean labels + real options for known ATS (Greenhouse)
  await snap();

  let aiInterpreted = false;
  // Opt-in: ALWAYS interpret with AI (max robustness, ignores the deterministic
  // result) — for users who'd rather pay tokens than risk a heuristic miss.
  if (forceAgent && cliId) {
    const aiFrame = await richestControlFrame(page);
    const aiFields = await agentInterpretForm(aiFrame, cliId, form.title || (await page.title().catch(() => ""))).catch(() => [] as ApplyField[]);
    if (aiFields.length) {
      frame = aiFrame;
      form = { ...form, fields: aiFields };
      aiInterpreted = true;
      await snap();
    }
  }

  // 5) Deterministic extraction found no usable APPLICATION form. Classify WHY
  //    first — then run the AGENTIC FALLBACK only for the genuinely AMBIGUOUS
  //    "no-form" case (controls are present but our heuristics produced nothing).
  //    A challenge/login/listing/expired/Workday page has no form to interpret,
  //    so we abort directly with the right message (no wasted AI run).
  if (!aiInterpreted && !looksLikeApplicationForm(form)) {
    const why = await classifyEmpty(page, url);
    // Driveable (controls present, not a hard block) + we have an agent → KEEP the
    // session open and hand off to the STREAMED drive route, so the user watches
    // the agent reach the form live (/api/apply/drive). Otherwise abort.
    if (cliId && why.code === "no-form") {
      const id = `apply-${crypto.randomUUID()}`;
      const title = form.title || (await page.title().catch(() => "")) || "Application";
      SESSIONS.set(id, { id, url, title, fields: [], context, page, frame, createdAt: Date.now(), formShot: shots[shots.length - 1] });
      return { id, title, fields: [], shots, issues: [], needsDrive: true };
    }
    return abort(why.message);
  }

  // 6) Soft issues the user should know about — surfaced, never silent.
  const [cap, multi] = await Promise.all([captchaWarning(page), multiStepInfo(page)]);
  const unlabeled = form.fields.filter((f) => !(f.label || "").trim()).length;
  const issues: ApplyIssue[] = [...consentIssues];
  if (cap) issues.push(cap);
  if (multi) issues.push(multi);
  if (aiInterpreted) issues.push({ level: "info", code: "ai-interpreted", message: "This form had an uncommon layout, so AI read its fields live — give them an extra check before submitting." });
  if (unlabeled > 0) issues.push({ level: "warn", code: "unlabeled-fields", message: `${unlabeled} field${unlabeled > 1 ? "s" : ""} couldn't be labelled cleanly — double-check ${unlabeled > 1 ? "them" : "it"} before submitting.` });

  const id = `apply-${crypto.randomUUID()}`;
  SESSIONS.set(id, { id, url, title: form.title, fields: form.fields, context, page, frame, createdAt: Date.now(), formShot: shots[shots.length - 1] });
  return { id, title: form.title, fields: form.fields, shots, issues };
}

export function getSession(id: string): Session | undefined {
  return SESSIONS.get(id);
}

/** Open a bare headed page on a URL (for the agentic drive loop / validation),
 *  without the full extract pipeline. Caller must close the context. */
export async function newDrivePage(url: string): Promise<{ page: Page; context: BrowserContext }> {
  if (globalThis.__coIdleTimer) clearTimeout(globalThis.__coIdleTimer);
  const browser = await headedBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  await gotoResilient(page, url);
  await dismissConsent(page).catch(() => {});
  await page.waitForTimeout(1000);
  return { page, context };
}

/** Extract+enrich the current page (used after the drive loop reaches a form). */
export async function extractCurrent(page: Page, url: string): Promise<{ frame: Frame; form: ExtractedForm }> {
  const r = await pickFormFrame(page);
  await enrichFromAts(url, r.form.fields);
  return r;
}

export function isApplicationFormFn(form: ExtractedForm): boolean {
  return looksLikeApplicationForm(form);
}

/** After the streamed drive loop reaches a form, extract+enrich it (Tier-3
 *  interpret as a last resort), UPDATE the open session, and return the fields +
 *  issues. Returns null if no real application form materialised. */
export async function finalizeDrivenSession(id: string, cliId?: string): Promise<{ title: string; fields: ApplyField[]; issues: ApplyIssue[] } | null> {
  const s = SESSIONS.get(id);
  if (!s) return null;
  let { frame, form } = await pickFormFrame(s.page);
  await enrichFromAts(s.url, form.fields);
  let aiInterpreted = false;
  if (!looksLikeApplicationForm(form) && cliId) {
    const aiFrame = await richestControlFrame(s.page);
    const aiFields = await agentInterpretForm(aiFrame, cliId, form.title || s.title).catch(() => [] as ApplyField[]);
    if (aiFields.length && looksLikeApplicationForm({ title: form.title, url: form.url, fields: aiFields })) {
      frame = aiFrame;
      form = { ...form, fields: aiFields };
      aiInterpreted = true;
    }
  }
  if (!looksLikeApplicationForm(form)) return null;
  s.frame = frame;
  s.fields = form.fields;
  if (form.title) s.title = form.title;
  const issues: ApplyIssue[] = [{ level: "info", code: "ai-navigated", message: "AI navigated to reach this application form on your machine — review the fields before submitting." }];
  if (aiInterpreted) issues.push({ level: "info", code: "ai-interpreted", message: "AI also read the fields live (uncommon layout) — give them an extra check." });
  const cap = await captchaWarning(s.page);
  if (cap) issues.push(cap);
  return { title: s.title, fields: s.fields, issues };
}

export async function closeSession(id: string): Promise<void> {
  const s = SESSIONS.get(id);
  SESSIONS.delete(id);
  await s?.context.close().catch(() => {});
  if (SESSIONS.size === 0) scheduleIdleClose();
}

export type FillStep = { fieldId: string; label: string; ok: boolean; thumb?: string };

/** True for a file field that wants the candidate's résumé/CV (vs. cover letter,
 *  portfolio, or a generic attachment we leave for the user). */
function isResumeField(f: ApplyField): boolean {
  return f.type === "file" && /resume|résumé|\bcv\b|curriculum|lebenslauf|currículum/i.test(f.label || "");
}

/** Fill the real form with verified answers, screenshotting after each field.
 *  Attaches the tailored CV PDF to résumé/CV file fields (cvPath). NEVER clicks a
 *  submit/apply control — only fills/selects/checks/attaches. */
export async function fillSession(
  id: string,
  answers: Record<string, string>,
  fieldsMeta: ApplyField[],
  cvPath?: string,
): Promise<{ steps: FillStep[]; navigated: boolean; issues: ApplyIssue[] }> {
  const s = SESSIONS.get(id);
  if (!s) throw new Error("apply session not found (it may have expired)");
  const byId = new Map(fieldsMeta.map((f) => [f.id, f]));
  const steps: FillStep[] = [];
  // Belt-and-suspenders: if filling ever navigates the page (i.e. something got
  // submitted), the URL path changes. We never submit by construction, but we
  // report it so the caller can flag it instead of silently "succeeding".
  const startPath = (() => {
    try {
      return new URL(s.frame.url()).pathname;
    } catch {
      return s.frame.url();
    }
  })();

  const shoot = async () => {
    try {
      const buf = await s.page.screenshot({ type: "jpeg", quality: 38 });
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      return undefined;
    }
  };

  // 1) Attach the tailored CV to every résumé/CV file field (even with no text
  //    answer). The real <input type=file> was tagged data-co-field at extract
  //    time; setInputFiles works even when the ATS visually hides it behind a
  //    dropzone. Other file fields (cover letter, portfolio) are left to the user.
  if (cvPath) {
    for (const meta of fieldsMeta) {
      if (!isResumeField(meta)) continue;
      let ok = false;
      try {
        await s.frame.locator(`[data-co-field="${cssAttr(meta.id)}"]`).first().setInputFiles(cvPath);
        ok = true;
      } catch {
        // fallback: any file input inside the same field container
        try {
          await s.frame.locator(`input[type=file]`).first().setInputFiles(cvPath);
          ok = true;
        } catch {
          ok = false;
        }
      }
      steps.push({ fieldId: meta.id, label: `${meta.label || "Resume"} (CV attached)`, ok, thumb: await shoot() });
    }
  }

  for (const [fid, raw] of Object.entries(answers)) {
    const meta = byId.get(fid);
    const value = (raw ?? "").toString();
    if (!meta || value === "") continue;
    if (meta.type === "file") continue; // handled above (CV) — never auto-fill other uploads
    // Defense-in-depth: NEVER auto-tick a legal consent/agreement checkbox — the
    // human must affirmatively accept. (The planner already flags these
    // needs_confirmation; this guarantees it even if it slips.)
    if (meta.type === "checkbox" && /\b(i (have )?read|i agree|i consent|i accept|consent to|privacy notice|terms|gdpr|data protection)\b/i.test(meta.label || "")) {
      steps.push({ fieldId: fid, label: `${meta.label} — you confirm`, ok: false, thumb: undefined });
      continue;
    }
    let ok = false;
    let gaveUp = false;
    try {
      const loc = s.frame.locator(`[data-co-field="${cssAttr(fid)}"]`).first();
      if (meta.combobox) {
        // react-select: open, type to filter, CLICK the matching option. We never
        // press Enter — in a form, Enter can submit. Clicking an option can't.
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click();
        await s.page.waitForTimeout(150);
        await loc.pressSequentially(value, { delay: 15 }).catch(async () => {
          await s.page.keyboard.type(value);
        });
        await s.page.waitForTimeout(300);
        const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const menu = '.select__menu .select__option, .select__menu-list [role="option"], [class*="menu" i] [role="option"]';
        const exact = s.frame.locator(menu).filter({ hasText: new RegExp(`^\\s*${esc}\\s*$`, "i") }).first();
        if (await exact.count()) {
          await exact.click();
        } else {
          // fall back to the first option that contains the typed text; else give
          // up (Escape closes the menu) — leave it for the human, never submit.
          const partial = s.frame.locator(menu).filter({ hasText: new RegExp(esc, "i") }).first();
          if (await partial.count()) await partial.click();
          else {
            await s.page.keyboard.press("Escape").catch(() => {});
            gaveUp = true;
          }
        }
      } else if (meta.type === "select") {
        await loc.selectOption({ label: value }).catch(async () => {
          await loc.selectOption(value);
        });
      } else if (meta.type === "checkbox") {
        const want = ["true", "1", "yes", "on", "checked"].includes(value.toLowerCase());
        let done = false;
        try {
          await loc.setChecked(want, { timeout: 3000 });
          done = true;
        } catch {
          // custom-styled checkbox with a hidden real <input> → click its label
          // (native toggle + React onChange) or force as a last resort.
          if ((await loc.isChecked().catch(() => false)) === want) {
            done = true;
          } else {
            const cid = await loc.getAttribute("id").catch(() => null);
            const lab = cid ? s.frame.locator(`label[for="${cssAttr(cid)}"]`).first() : null;
            if (lab && (await lab.count())) {
              await lab.click().catch(() => {});
              done = true;
            } else {
              try {
                await loc.check({ force: true });
                done = true;
              } catch {
                /* leave for the user */
              }
            }
          }
        }
        gaveUp = !done;
      } else if (meta.type === "radio") {
        const r = s.frame.locator(`[data-co-field="${cssAttr(fid)}"][data-co-option="${cssAttr(value)}"]`).first();
        await r.check({ timeout: 3000 }).catch(async () => {
          await r.check({ force: true }).catch(async () => {
            const rid = await r.getAttribute("id").catch(() => null);
            if (rid) await s.frame.locator(`label[for="${cssAttr(rid)}"]`).first().click().catch(() => { gaveUp = true; });
            else gaveUp = true;
          });
        });
      } else {
        await loc.fill(value);
      }
      ok = !gaveUp;
    } catch {
      ok = false;
    }
    steps.push({ fieldId: fid, label: meta.label, ok, thumb: await shoot() });
  }
  const endPath = (() => {
    try {
      return new URL(s.frame.url()).pathname;
    } catch {
      return s.frame.url();
    }
  })();
  // Read the real form back: did every answer actually land? any validation
  // error? — so we warn the user about silent divergence before the handoff.
  const issues = await verifyFill(s.frame, fieldsMeta, answers).catch(() => [] as ApplyIssue[]);
  return { steps, navigated: endPath !== startPath, issues };
}

/** Hand the real (now pre-filled) form to the HUMAN to review + submit. The
 *  window was kept OFF-SCREEN during fill, so bringToFront alone wouldn't make it
 *  visible — we reposition it on-screen via CDP first. We never submit. */
export async function handoffSession(id: string): Promise<void> {
  const s = SESSIONS.get(id);
  if (!s) throw new Error("apply session not found");
  try {
    const cdp = await s.context.newCDPSession(s.page);
    const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 80, top: 60, width: 1280, height: 920, windowState: "normal" },
    });
    await cdp.detach().catch(() => {});
  } catch {
    /* CDP unavailable → bringToFront still raises it */
  }
  await s.page.bringToFront().catch(() => {});
}
