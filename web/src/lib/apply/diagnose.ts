import type { Page, Frame } from "playwright-core";
import type { ApplyField } from "./extract";
import type { ApplyIssue } from "./issue";

export type { ApplyIssue };

// ─────────────────────────────────────────────────────────────────────────────
// Robust block/obstacle detection for the local Playwright form-interpreter.
// Through-line guard (from the robustness taxonomy): only ever ABORT when there
// is NO fillable form after settle — a captcha/cookie badge over a populated form
// is NOT a block. Abort-level categories require ≥2 independent signal classes.
// We never auto-solve a challenge; we hand the human a clear, actionable message.
// ─────────────────────────────────────────────────────────────────────────────

/** Cheapest + first check: the navigation Response status/headers. Returns a hard
 *  block for auth/forbidden/geo/rate-limit/server/not-found — before any DOM work. */
export function statusBlock(status: number | null | undefined, headers: Record<string, string>): ApplyIssue | null {
  if (!status) return null;
  const cf = headers["cf-ray"] || headers["cf-mitigated"] || headers["cf-request-id"];
  if (status === 401 || status === 407) return { level: "block", code: "auth-required", message: "Esta página exige início de sessão. Abre-a diretamente, inicia sessão e volta a colar aqui o endereço do formulário." };
  if (status === 451) return { level: "block", code: "geo-block", message: "Esta página está bloqueada por motivos legais ou regionais. Não é possível abrir o formulário aqui." };
  if (status === 403) return { level: "block", code: cf ? "bot-block" : "forbidden", message: cf ? "Esta página tem uma verificação contra robôs. Abre-a diretamente no navegador e volta a colar aqui o endereço." : "A página devolveu «403 — acesso recusado». Abre-a diretamente no navegador para verificares." };
  if (status === 429) return { level: "block", code: "rate-limited", message: "O site está a limitar os pedidos. Espera um minuto e volta a tentar, ou abre-o diretamente." };
  if (status >= 500) return { level: "block", code: "server-error", message: `O site devolveu um erro (${status}). Volta a tentar dentro de alguns minutos ou abre-o diretamente.` };
  if (status === 404 || status === 410) return { level: "block", code: "not-found", message: "Esta oferta já não está disponível. Pode ter sido encerrada ou o endereço pode estar errado." };
  return null;
}

const CONSENT_ROOTS =
  '#onetrust-banner-sdk, #CybotCookiebotDialog, #truste-consent-track, .qc-cmp2-container, #usercentrics-root, [id*="cookie" i][class*="banner" i], [class*="cookie-consent" i], [aria-label*="cookie" i]';
const CONSENT_BUTTONS = [
  "#onetrust-accept-btn-handler",
  "#onetrust-button-accept-all",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  '.qc-cmp2-button[mode="primary"]',
  "#truste-consent-button",
];

/** Auto-dismiss a cookie/consent overlay that covers the form (it only HIDES the
 *  form, it's never a hard block). Tries vendor buttons, then a generic accept. */
export async function dismissConsent(page: Page): Promise<ApplyIssue[]> {
  try {
    const root = page.locator(CONSENT_ROOTS).first();
    if (!(await root.count().catch(() => 0))) return [];
    if (!(await root.isVisible().catch(() => false))) return [];
    for (const sel of CONSENT_BUTTONS) {
      const b = page.locator(sel).first();
      if ((await b.count().catch(() => 0)) && (await b.isVisible().catch(() => false))) {
        await b.click({ timeout: 2000 }).catch(() => {});
        return [{ level: "info", code: "consent-dismissed", message: "O aviso de cookies foi fechado para chegar ao formulário." }];
      }
    }
    const g = page.getByRole("button", { name: /^(accept|allow|agree|got it|i agree|accept all)/i }).first();
    if (await g.count().catch(() => 0)) {
      await g.click({ timeout: 2000 }).catch(() => {});
      return [{ level: "info", code: "consent-dismissed", message: "O aviso de cookies foi fechado para chegar ao formulário." }];
    }
  } catch {
    /* never let consent handling break the open */
  }
  return [];
}

/** Force same-tab navigation: many "Apply" links are <a target="_blank"> (e.g.
 *  openai.com → jobs.ashbyhq.com/…/application). Without this, clicking Apply
 *  opens a NEW tab we don't follow and the loop never reaches the form. We strip
 *  target=_blank in every frame so any click/navigation stays in OUR page. */
export async function dropNewTabs(page: Page): Promise<void> {
  for (const fr of page.frames()) {
    await fr
      .evaluate(() => {
        document.querySelectorAll('a[target="_blank"], a[target="_new"], form[target]').forEach((el) => el.removeAttribute("target"));
        // also neutralise window.open so JS "apply" handlers navigate in-tab
        try {
          (window as unknown as { open: (u?: string) => Window | null }).open = (u?: string) => {
            if (u) location.href = u;
            return null;
          };
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }
}

/** SPA / apply-behind-a-button: if no form yet, click the first visible Apply CTA
 *  (NEVER a submit) to reveal the form. If it's an <a> with an application href,
 *  NAVIGATE there directly (robust vs popups). Returns true if it acted. */
export async function tryApplyTrigger(page: Page): Promise<boolean> {
  try {
    // 1) Most reliable: an <a> linking straight to a known ATS application (e.g.
    //    openai.com → jobs.ashbyhq.com/…/application). Navigate there in-tab.
    const atsLink = page.locator('a[href*="ashbyhq"], a[href*="greenhouse"], a[href*="lever.co"], a[href*="smartrecruiters"], a[href*="workable"], a[href*="recruitee"], a[href*="bamboohr"], a[href*="jobvite"], a[href*="teamtailor"], a[href*="myworkdayjobs"], a[href*="/apply"], a[href*="/application"]').first();
    if (await atsLink.count().catch(() => 0)) {
      const href = await atsLink.getAttribute("href").catch(() => null);
      if (href && /^https?:\/\//i.test(href) && !/submit/i.test(href)) {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        return true;
      }
    }
    // 2) Otherwise click a visible Apply CTA (never a submit). dropNewTabs() has
    //    already neutralised target=_blank / window.open so it stays in-tab.
    const t = page
      .getByRole("button", { name: /apply|start application|begin application/i })
      .or(page.getByRole("link", { name: /apply/i }))
      .first();
    if ((await t.count().catch(() => 0)) && (await t.isVisible().catch(() => false))) {
      const label = (await t.innerText().catch(() => "")).toLowerCase();
      if (/submit|applied|withdraw/.test(label)) return false;
      await t.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** When extraction yields 0 fields, classify WHY so we abort with the RIGHT
 *  message (bot-challenge vs login wall vs closed posting vs unsupported). */
export async function classifyEmpty(page: Page, url: string): Promise<ApplyIssue> {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const sig = await page
    .evaluate(() => {
      const t = (document.title || "").toLowerCase();
      const body = (document.body?.innerText || "").toLowerCase().slice(0, 6000);
      const hasPassword = !!document.querySelector('input[type="password"]');
      const challengeDom = !!document.querySelector(
        '#challenge-running, #challenge-form, .cf-browser-verification, iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, #px-captcha, [class*="datadome" i], #cf-please-wait',
      );
      return { t, body, hasPassword, challengeDom };
    })
    .catch(() => ({ t: "", body: "", hasPassword: false, challengeDom: false }));

  const u = url.toLowerCase();
  const challTitle = /just a moment|checking your browser|one moment please|verifying you|attention required/.test(sig.t);
  const challUrl = /__cf_chl|challenges\.cloudflare\.com|\/cdn-cgi\/|datadome|px-captcha/.test(u);
  const challText = /(verify (you|that you)|are you human|not a robot|human verification|checking your browser|enable javascript and cookies)/.test(sig.body);
  if ([challTitle, challUrl, sig.challengeDom, challText].filter(Boolean).length >= 2) {
    return { level: "block", code: "bot-challenge", message: "Esta página exige uma verificação humana antes de mostrar o formulário. Abre-a diretamente no navegador, conclui a verificação e volta a colar aqui o endereço." };
  }
  if (sig.hasPassword || /\/(login|sign-?in|register|sign-?up|auth|account|mfa|2fa)(\/|$|\?)/.test(u)) {
    return { level: "block", code: "login-wall", message: "Esta página exige início de sessão ou a criação de uma conta. Abre-a diretamente, inicia sessão e cola aqui o endereço do formulário." };
  }
  if (/no longer accepting|position has been filled|posting is closed|no longer available|this (job|position|posting) (is |has )?(closed|expired|been filled)/.test(sig.body) || /not found|no longer|removed|closed/.test(sig.t)) {
    return { level: "block", code: "expired", message: "Esta oferta foi encerrada ou expirou e já não aceita candidaturas." };
  }
  if (/myworkdayjobs\.com$/i.test(host)) {
    return { level: "block", code: "workday", message: "Os formulários Workday ainda não podem ser preenchidos dentro da aplicação. Abre a oferta e candidata-te diretamente no site." };
  }
  if (/^(jobs|careers|empleos|empregos|all jobs|open (positions|roles)|search jobs|current openings)/i.test(sig.t) || /\/(jobs|careers|search|positions)\/?(\?|$)/.test(u)) {
    return { level: "block", code: "listing-page", message: "Este endereço parece abrir a lista de empregos, não uma candidatura. Abre a oferta concreta e cola o endereço do respetivo formulário." };
  }
  return { level: "block", code: "no-form", message: "Não foi encontrado um formulário nesta página. Abre a candidatura da oferta e cola aqui o respetivo endereço." };
}

/** An INTERACTIVE captcha (a checkbox/widget the user must click) present on the
 *  form → warn. We deliberately IGNORE invisible reCAPTCHA v3 (the .grecaptcha-
 *  badge that's on nearly every ATS form and needs NO user action) so the warning
 *  isn't constant noise. */
export async function captchaWarning(page: Page): Promise<ApplyIssue | null> {
  const interactive = await page
    .evaluate(() => {
      const vis = (el: Element | null) => {
        if (!el) return false;
        const r = (el as HTMLElement).getBoundingClientRect();
        return (el as HTMLElement).offsetParent !== null && r.width > 40 && r.height > 20;
      };
      const some = (sel: string) => Array.from(document.querySelectorAll(sel)).some(vis);
      // v2 checkbox (anchor iframe / visible widget), hCaptcha checkbox, Turnstile widget.
      // NOT .grecaptcha-badge (invisible v3) and NOT the bare bframe.
      return (
        some('iframe[src*="recaptcha/api2/anchor"]') ||
        some('.g-recaptcha[data-size="normal"]') ||
        some('iframe[src*="hcaptcha.com"][src*="frame=checkbox"], .h-captcha iframe') ||
        some('.cf-turnstile')
      );
    })
    .catch(() => false);
  return interactive ? { level: "warn", code: "captcha-present", message: "Este formulário tem um captcha. Terás de o concluir no formulário original." } : null;
}

/** Conservatively detect a multi-STEP form (we only read/fill page 1) so we can
 *  set the user's expectation that they'll continue on the real form. Fires only
 *  on a "Step 1 of N" indicator, or a visible Next/Continue with NO Submit. */
export async function multiStepInfo(page: Page): Promise<ApplyIssue | null> {
  const ms = await page
    .evaluate(() => {
      const txt = (document.body?.innerText || "").toLowerCase();
      const stepText = /\b(step|page|stage)\s*\d+\s*(of|\/)\s*\d+/.test(txt);
      const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const btns = Array.from(document.querySelectorAll("button, a, [role=button]"));
      const label = (b: Element) => (b.textContent || "").replace(/\s+/g, " ").trim();
      const hasNext = btns.some((b) => vis(b) && /^(next|continue|save (and|&) continue|next step|continue to)\b/i.test(label(b)));
      const hasSubmit = btns.some((b) => vis(b) && /^(submit application|submit|send application|apply now)\b/i.test(label(b)));
      return (stepText || hasNext) && !hasSubmit;
    })
    .catch(() => false);
  return ms ? { level: "info", code: "multi-step", message: "Este formulário tem vários passos. Depois desta página, continuarás no formulário original." } : null;
}

/** READ THE REAL FORM BACK after filling: did every answer land? required fields
 *  still empty? any validation error visible? — the self-verification a blind
 *  selector script can't do. Returns warnings to show BEFORE the human submits. */
export async function verifyFill(frame: Frame, fields: ApplyField[], answers: Record<string, string>): Promise<ApplyIssue[]> {
  const meta = fields.map((f) => ({ id: f.id, label: f.label || "este campo", type: f.type, required: !!f.required, combobox: !!f.combobox }));
  type R = { mismatches: string[]; requiredEmpty: string[]; valErrors: string[] };
  const res = await frame
    .evaluate(
      ({ meta, answers }): R => {
        const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const mismatches: string[] = [];
        const requiredEmpty: string[] = [];
        for (const f of meta) {
          const intended = answers[f.id];
          const el = document.querySelector(`[data-co-field="${f.id}"]`) as HTMLElement | null;
          if (!el) continue;
          if (f.type === "file") {
            // confirm a file actually landed on the input (the CV attach can fail
            // silently on a custom dropzone). Only warn if the field is required.
            const filesEl = el as HTMLInputElement;
            const has = !!(filesEl.files && filesEl.files.length > 0);
            if (f.required && !has) requiredEmpty.push(f.label);
            continue;
          }
          let actual = "";
          if (f.type === "checkbox") {
            actual = (el as HTMLInputElement).checked ? "true" : "";
          } else if (f.type === "radio") {
            const grp = Array.from(document.querySelectorAll(`[data-co-field="${f.id}"]`)) as HTMLInputElement[];
            actual = grp.some((r) => r.checked) ? "checked" : "";
          } else if (f.combobox) {
            // react-select keeps the chosen value in a sibling .select__single-value
            // (the tagged input stays empty). Read leniently: only conclude "empty"
            // when a placeholder is visibly shown — otherwise assume OK (never a
            // false "didn't land" warning).
            const shell = el.closest('[class*="select-shell" i], [class*="select__container" i], [class*="select__control" i], [class*="value-container" i]') || el.parentElement?.parentElement || el.parentElement;
            const sv = shell?.querySelector('.select__single-value, [class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i]');
            const ph = shell?.querySelector('.select__placeholder, [class*="placeholder" i]');
            const svText = (sv?.textContent || "").trim();
            if (svText) actual = svText; // a value is shown
            else if (ph && (ph as HTMLElement).offsetParent !== null) actual = ""; // placeholder visible → empty
            else actual = intended || "ok"; // can't read reliably → don't flag
          } else {
            actual = (el as HTMLInputElement).value || "";
          }
          if (intended && intended.trim() && !norm(actual)) mismatches.push(f.label);
          else if (f.required && !norm(actual) && !(intended && intended.trim())) requiredEmpty.push(f.label);
        }
        const errSel = '[aria-invalid="true"], [role="alert"], [class*="error" i]:not([class*="clear" i]):not([class*="error-free" i])';
        const valErrors: string[] = [];
        for (const e of Array.from(document.querySelectorAll(errSel)) as HTMLElement[]) {
          const txt = (e.textContent || "").replace(/\s+/g, " ").trim();
          if (txt && txt.length > 2 && txt.length < 160 && e.offsetParent !== null) valErrors.push(txt);
        }
        return { mismatches, requiredEmpty, valErrors: Array.from(new Set(valErrors)).slice(0, 5) };
      },
      { meta, answers },
    )
    .catch(() => ({ mismatches: [], requiredEmpty: [], valErrors: [] }) as R);

  const out: ApplyIssue[] = [];
  if (res.mismatches.length) out.push({ level: "warn", code: "fill-mismatch", message: `Estas respostas podem não ter sido preenchidas corretamente no formulário original: ${res.mismatches.slice(0, 4).join(", ")}${res.mismatches.length > 4 ? "…" : ""}.` });
  if (res.requiredEmpty.length) out.push({ level: "warn", code: "required-empty", message: `Ainda há campos obrigatórios vazios: ${res.requiredEmpty.slice(0, 4).join(", ")}${res.requiredEmpty.length > 4 ? "…" : ""}.` });
  for (const v of res.valErrors) out.push({ level: "warn", code: "validation", message: `O formulário assinalou: «${v}».` });
  return out;
}
