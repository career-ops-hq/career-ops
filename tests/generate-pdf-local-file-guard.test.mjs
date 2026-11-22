// tests/generate-pdf-local-file-guard.test.mjs — what the CV page may load
// while it renders to PDF (GHSA-m426).
//
// renderInPage loads the CV from file:// and its route used to let every file:
// request through. Markup that needs no JavaScript (<iframe>, <object>,
// <embed>) then painted any readable file into the PDF: HTML influenced by a
// job posting could carry ~/.env or config/profile.yml to an employer. Now a
// file: request loads only for the document itself, and for an image, font or
// stylesheet under the CV's directory or the configured profile photo.
import { pass, fail, toolUnavailable } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pdfRequestAllowed, injectRenderCsp, RENDER_CSP } from '../generate-pdf.mjs';

console.log('\ngenerate-pdf.mjs — local files the CV page may load');

const check = (ok, label, detail = '') => (ok ? pass(label) : fail(`${label}${detail ? ` — ${detail}` : ''}`));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'co-pdf-files-')));
try {
  const baseDir = join(root, 'output');
  const outside = join(root, 'outside');
  mkdirSync(join(baseDir, 'img'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(baseDir, 'img', 'logo.png'), PNG);
  writeFileSync(join(outside, 'secret.txt'), 'SECRET-TOKEN-4242\n');
  writeFileSync(join(outside, 'me.png'), PNG);
  writeFileSync(join(outside, 'other.png'), PNG);
  let linked = false;
  try {
    symlinkSync(join(outside, 'secret.txt'), join(baseDir, 'link.css'));
    linked = true;
  } catch {
    // Windows without symlink rights: the symlink case is skipped below.
  }
  const mainDocUrl = pathToFileURL(join(baseDir, '.career-ops-render-x.html')).href;
  const scope = { mainDocUrl, baseDir, photoPath: join(outside, 'me.png') };
  const url = (p) => pathToFileURL(p).href;
  const allowed = (u, resourceType, isMainDocument = false) => pdfRequestAllowed({ url: u, resourceType, isMainDocument }, scope);

  check(allowed(mainDocUrl, 'document', true), 'the CV document loads in the main frame');
  check(!allowed(mainDocUrl, 'document', false), 'the CV document does not load again inside a frame');
  check(allowed('data:font/woff2;base64,AAAA', 'font'), 'data: assets load (inlined template fonts)');
  check(allowed(url(join(baseDir, 'img', 'logo.png')), 'image'), 'an image under the CV directory loads');
  check(allowed(url(join(baseDir, 'img', 'logo.png')), 'stylesheet') && allowed(url(join(baseDir, 'img', 'logo.png')), 'font'),
    'a stylesheet or font under the CV directory loads');
  check(allowed(url(join(outside, 'me.png')), 'image'), 'the configured profile photo loads from outside the CV directory');
  check(!allowed(url(join(outside, 'me.png')), 'document'), 'the profile photo does not load as a frame document');
  check(!allowed(url(join(outside, 'other.png')), 'image'), 'any other image outside the CV directory is refused');
  check(!allowed(url(join(outside, 'secret.txt')), 'document'), 'a frame of a file outside the CV directory is refused');
  check(!allowed(url(join(baseDir, 'img', 'logo.png')), 'document'), 'a frame of a file inside the CV directory is refused too');
  check(!allowed(url(join(outside, 'secret.txt')), 'other') && !allowed(url(join(outside, 'secret.txt')), 'object'),
    'object/embed loads are refused');
  check(!allowed(url(join(baseDir, 'missing.png')), 'image'), 'a file that does not exist is refused');
  check(!allowed('https://example.com/x.png', 'image'), 'remote requests stay refused');
  if (linked) check(!allowed(url(join(baseDir, 'link.css')), 'stylesheet'), 'a symlink in the CV directory that points out of it is refused');

  // The CSP goes first in <head>, so it governs everything after it.
  const withHead = injectRenderCsp('<!doctype html><html><head><title>t</title></head><body></body></html>');
  check(withHead.includes(`<head><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}"><title>`), 'CSP is the first element of <head>');
  const noHead = injectRenderCsp('<html><body>x</body></html>');
  check(/^<html><head><meta http-equiv="Content-Security-Policy"/.test(noHead), 'a document without <head> gets one with the CSP');
  check(/frame-src 'none'/.test(RENDER_CSP) && /object-src 'none'/.test(RENDER_CSP), 'the CSP refuses frames and plugin objects');

  // On Chromium itself: the resource types it reports are the ones the rule
  // expects, and a frame, an object or an embed of a secret file never loads.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    toolUnavailable('browser', 'PDF local-file checks on Chromium skipped: Playwright is not installed');
  }
  let browser;
  if (chromium) {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      toolUnavailable('browser', `PDF local-file checks on Chromium skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
    }
  }
  if (browser) {
    try {
      const docPath = join(baseDir, '.career-ops-render-x.html');
      const secret = url(join(outside, 'secret.txt'));
      const body = `<!doctype html><html><head><title>cv</title></head><body>
        <p>CV</p>
        <img src="img/logo.png">
        <img src="${url(join(outside, 'other.png'))}">
        <iframe src="${secret}"></iframe>
        <object data="${secret}" type="text/plain"></object>
        <embed src="${secret}" type="text/plain">
      </body></html>`;
      const OLD_ROUTE = (route) => {
        const u = route.request().url();
        return u.startsWith('file:') || u.startsWith('data:') ? route.continue() : route.abort();
      };
      const NEW_ROUTE = (page, decisions) => (route) => {
        const request = route.request();
        const isMainDocument = request.isNavigationRequest() && request.frame() === page.mainFrame();
        const ok = pdfRequestAllowed({ url: request.url(), resourceType: request.resourceType(), isMainDocument }, scope);
        decisions.push({ url: request.url(), type: request.resourceType(), ok });
        return ok ? route.continue() : route.abort();
      };
      const render = async (html, handler) => {
        writeFileSync(docPath, html);
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        const decisions = [];
        await page.route('**/*', handler === 'new' ? NEW_ROUTE(page, decisions) : OLD_ROUTE);
        await page.goto(mainDocUrl, { waitUntil: 'load' });
        let leaked = false;
        for (const frame of page.frames()) {
          const text = await frame.content().catch(() => '');
          if (text.includes('SECRET-TOKEN-4242')) leaked = true;
        }
        await context.close();
        return { leaked, decisions };
      };

      // Control: the old route and no CSP paint the secret, so the checks
      // below can tell a leak from a page that showed nothing.
      const before = await render(body, 'old');
      check(before.leaked, 'Chromium control: with the old route and no CSP, the secret file is painted into the page');

      // The route rule alone.
      const routed = await render(body, 'new');
      const secretLoads = routed.decisions.filter((d) => d.url === secret);
      check(!routed.leaked && secretLoads.length >= 1 && secretLoads.every((d) => !d.ok),
        'Chromium: the route refuses every frame/object/embed request for the secret file', JSON.stringify(secretLoads));
      check(routed.decisions.some((d) => d.url.endsWith('/img/logo.png') && d.type === 'image' && d.ok),
        'Chromium: the image next to the CV loads, reported as an image');

      // The CSP alone, under the old permissive route.
      const csp = await render(injectRenderCsp(body), 'old');
      check(!csp.leaked, 'Chromium: the CSP alone keeps the secret out, should the route ever let it through');
    } finally {
      await browser.close().catch(() => {});
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
