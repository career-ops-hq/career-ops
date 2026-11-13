// tests/browser-extract-page-title.test.mjs — readDom() reports the page's own
// document title beside the <h1> it uses as `title`.
//
// challengeFailure() refuses a Cloudflare challenge served in place of a JD by
// the document title ("Just a moment..."), which readDom() passes over for the
// page's <h1> ("Humans only") (#6798). tests/browser-extract-challenge.test.mjs
// drives the CLI against a fake page that hands that title over directly, so a
// regression in the `document.title` read inside readDom() would still pass
// there. This reads a real page. It needs headless Chromium and is skipped with
// a warning when Chromium cannot launch, as browser-extract-unavailable is.
import { pass, fail, toolUnavailable, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nbrowser-extract.mjs — readDom() reads the document title as well as the <h1>');

let browser;
try {
  const { readDom, challengeFailure } = await import(pathToFileURL(join(ROOT, 'browser-extract.mjs')).href);
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    toolUnavailable('browser', `readDom page-title test skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const page = await browser.newPage();
    const body = 'Please wait while we check that your browser can reach careers.example.com securely. '.repeat(4);
    await page.setContent(`<html><head><title>Just a moment...</title></head><body><h1>Humans only</h1><main><p>${body}</p></main></body></html>`);
    const raw = await readDom(page);
    if (raw.title === 'Humans only' && raw.pageTitle === 'Just a moment...') {
      pass('readDom() keeps the <h1> as title and reports the document title as pageTitle');
    } else {
      fail(`readDom() titles: ${JSON.stringify({ title: raw.title, pageTitle: raw.pageTitle })}`);
    }
    const failure = challengeFailure({ status: 403, pageTitle: raw.pageTitle, url: 'https://careers.example.com/jobs/1' });
    if (failure?.code === 'bot_challenge') pass('the title readDom() read is the one challengeFailure() refuses on an HTTP 403');
    else fail(`challengeFailure() on the read title: ${JSON.stringify(failure)}`);
  }
} catch (e) {
  fail(`browser-extract page-title test crashed: ${e.message}`);
} finally {
  if (browser) await browser.close();
}
