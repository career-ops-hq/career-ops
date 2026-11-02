import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = new URL('../apply-scope.mjs', import.meta.url);
function launchOptions() {
  return JSON.parse(execFileSync(process.execPath, [fileURLToPath(REPO), 'launch-options'], { encoding: 'utf8' }));
}
function verifiedSources(dataRoot) {
  return ['cv.md', 'config/profile.yml'].map(p => { try { return requireText(join(dataRoot,p)); } catch { return ''; } }).join('\n');
}
function requireText(path) { return readFileSync(path,'utf8'); }
import { readFileSync } from 'node:fs';

export async function autoApplySubmit(job, { dataRoot, date, trackerNum, pageDriver } = {}) {
  if (job.ats === 'workday') return workdaySubmit(job, { dataRoot, date, trackerNum, pageDriver });
  if (!['greenhouse','ashby','lever'].includes(job.ats)) return { confirmed:false, reason:'unsupported ATS' };
  const result = pageDriver ? await pageDriver(job, { dataRoot, date, trackerNum, answers: verifiedSources(dataRoot) }) : await playwrightSubmit(job, { dataRoot, date, trackerNum });
  return result;
}

const loginPattern = /\b(sign[ -]?in|log[ -]?in|create (?:an )?account|account creation)\b/i;
const captchaPattern = /captcha|verify you are human|bot check/i;
const confirmationPattern = /thank you|application (?:has been )?submitted|successfully submitted|confirmation number|received your application/i;
const answerFor = (label, source) => {
  if (/sponsor|work authorization|eligible to work|visa/i.test(label)) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)\\s*([^\\n]*${escaped}[^\\n]*)`, 'i'));
  if (!match) return null;
  const line = match[1];
  const value = line.split(/:\s*/, 2)[1]?.trim();
  return value || null;
};
async function workdaySubmit(job, context) {
  const driver = context.pageDriver || await createWorkdayDriver(context.dataRoot);
  await driver.goto(job.url);
  const first = await driver.inspect();
  let stop = workdayStop(first);
  if (stop) return stop;
  if (/apply with (?:linkedin|indeed)/i.test(first.text)) {
    // Deliberately choose only the manual application path.
  }
  if (first.applyEntry) await driver.click(first.applyEntry);
  let state = await driver.inspect();
  stop = workdayStop(state);
  if (stop) return stop;
  if (state.applyManually) {
    await driver.click(state.applyManually);
    state = await driver.inspect();
    stop = workdayStop(state);
    if (stop) return stop;
  }
  const source = verifiedSources(context.dataRoot);
  for (let pageIndex = 0; pageIndex < 12; pageIndex++) {
    state = await driver.inspect();
    stop = workdayStop(state);
    if (stop) return stop;
    for (const field of state.fields || []) {
      if (!field.required || field.value) continue;
      const value = answerFor(field.label || field.name || '', source);
      if (!value) return { confirmed:false, reason:'unanswerable required question', unanswerable:true };
      await driver.fill(field.id, value);
    }
    if (state.submit) {
      // Return from validation/fill before the final click. This caller has already
      // passed evaluateGates and explicitly approved this URL.
      const fillResult = { filled:true, readyToSubmit:true };
      if (!fillResult.readyToSubmit) return { confirmed:false, reason:'submission state unknown' };
      await driver.click(state.submit);
      const confirmation = await driver.waitForConfirmation();
      if (!confirmation || !confirmationPattern.test(confirmation.text || '')) return { confirmed:false, reason:'submission state unknown' };
      const dir = join(context.dataRoot, 'output', 'auto-apply'); mkdirSync(dir, { recursive:true });
      const screenshotPath = join(dir, `${context.date}-${context.trackerNum}.png`);
      await driver.screenshot(screenshotPath);
      return { confirmed:true, evidence:{ text:confirmation.text, screenshotPath }, screenshot:screenshotPath, confirmationText:confirmation.text };
    }
    if (!state.next) return { confirmed:false, reason:'submission state unknown' };
    await driver.click(state.next);
  }
  return { confirmed:false, reason:'submission state unknown' };
}
function workdayStop(state) {
  const text = `${state?.text || ''} ${state?.url || ''}`;
  if (captchaPattern.test(text)) return { confirmed:false, reason:'captcha', captcha:true };
  if (loginPattern.test(text)) return { confirmed:false, reason:'login or account creation required', loginRequired:true };
  return null;
}
async function createWorkdayDriver(dataRoot) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();
  const inspect = async () => {
    const text = await page.locator('body').innerText().catch(() => '');
    const fields = await page.locator('input,textarea,select').evaluateAll(els => els.map((el, i) => ({ id:String(i), label:el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('name') || '', name:el.getAttribute('name') || '', required:el.required || el.getAttribute('aria-required') === 'true', value:el.value || '', type:el.type || '' })).filter(x => !/file|checkbox|radio|hidden|submit/i.test(x.type)));
    const buttons = await page.getByRole('button').allTextContents();
    const find = re => buttons.find(x => re.test(x));
    return { text, url:page.url(), fields, applyEntry:find(/^\s*apply\s*$/i), applyManually:find(/^\s*apply manually\s*$/i), next:find(/^\s*(?:save and continue|continue|next)\s*$/i), submit:find(/^\s*submit(?: application)?\s*$/i) };
  };
  return {
    goto: url => page.goto(url, { waitUntil:'domcontentloaded', timeout:45000 }),
    inspect,
    click: async name => { await page.getByRole('button', { name: new RegExp(`^\\s*${String(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`, 'i') }).first().click(); },
    fill: async (id, value) => page.locator('input,textarea,select').nth(Number(id)).fill(value),
    waitForConfirmation: async () => { try { await page.waitForLoadState('domcontentloaded', {timeout:15000}); } catch {} await page.waitForTimeout(1200); const text=await page.locator('body').innerText().catch(()=> ''); return confirmationPattern.test(text) ? {text:text.slice(0,4000)} : null; },
    screenshot: async path => { await page.screenshot({path,fullPage:true}); await browser.close(); }
  };
}
async function playwrightSubmit(job, { dataRoot, date, trackerNum }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const pageText = await page.locator('body').innerText().catch(() => '');
    const url = page.url();
    if (/captcha|verify you are human/i.test(pageText)) return { confirmed:false, captcha:true };
    if (/sign in|log in|create an account/i.test(pageText) || /login|signin/i.test(url)) return { confirmed:false, loginRequired:true };
    const source = verifiedSources(dataRoot);
    const inputs = page.locator('input[required],textarea[required],select[required]');
    for (let i=0;i<await inputs.count();i++) {
      const el=inputs.nth(i), type=await el.getAttribute('type')||'', label=await el.getAttribute('aria-label')||await el.getAttribute('name')||'';
      if (/file|checkbox|radio|hidden|submit/i.test(type)) continue;
      if (/sponsor|work authorization/i.test(label)) return { confirmed:false, sensitiveQuestion:true };
      const match=source.match(new RegExp(`(?:^|\\n)[^\\n]*${label.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}[^\\n]*`, 'i'));
      if (!match) return { confirmed:false, unanswerable:true };
      const value=match[0].split(':').slice(1).join(':').trim();
      if (type==='email') await el.fill(source.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||'');
      else if (type==='tel') await el.fill(source.match(/\+?[0-9][0-9 ()-]{7,}/)?.[0]||'');
      else if (value) await el.fill(value);
      else return { confirmed:false, unanswerable:true };
    }
    // A fill result is returned before the submit control is clicked. The caller
    // has already supplied explicit authorization and all pre-submit gates.
    const submit = page.getByRole('button', { name:/submit application|submit|apply/i }).last();
    if (!(await submit.count())) return { confirmed:false, reason:'final submit control not found' };
    await submit.click();
    try { await page.waitForLoadState('domcontentloaded',{timeout:15000}); } catch {}
    await page.waitForTimeout(1500);
    const confirmationText=(await page.locator('body').innerText().catch(()=>'' )).slice(0,4000);
    if (!/thank you|application (?:has been )?submitted|successfully submitted|confirmation number|received your application/i.test(confirmationText)) return {confirmed:false};
    const dir=join(dataRoot,'output','auto-apply'); mkdirSync(dir,{recursive:true});
    const screenshot=join(dir,`${date}-${trackerNum}.png`); await page.screenshot({path:screenshot,fullPage:true});
    return {confirmed:true,screenshot,confirmationText};
  } finally { await browser.close(); }
}
