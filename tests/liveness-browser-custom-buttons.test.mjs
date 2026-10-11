// tests/liveness-browser-custom-buttons.test.mjs — checkUrlLiveness reads a
// design-system button (a custom element named *-button) as an Apply control.
//
// UKG Pro (UltiPro) renders Apply as <ukg-button>Apply now</ukg-button>. The
// native <button> inside its shadow root has no text of its own (the label is
// slotted in), so a read of `a, button, input, [role="button"]` alone found no
// Apply control on a live posting, and `scan --verify` dropped it as
// skipped_no_apply_control.
//
// A custom element with a shadow root needs a real DOM, so this file launches
// Chromium and is skipped with a warning where it cannot launch. The page is
// served by a route registered after the liveness guard's, which makes it run
// first: nothing is resolved or fetched.
import { pass, fail, warn } from './helpers.mjs';
import { checkUrlLiveness, installLivenessRouteGuard, newLivenessPage } from '../liveness-browser.mjs';

console.log('\nliveness-browser — custom-element buttons');

const POSTING_URL = 'https://careers.example.com/jobs/1234';
const POSTING = `<p>${'Senior Analyst. '.repeat(30)}</p>`;
// The shape UKG ships: an open shadow root whose <button> holds only a slot.
const UKG_BUTTON = `<script>
  customElements.define('ukg-button', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<button type="button"><slot></slot></button>';
    }
  });
</script>`;
const html = (body) => `<!doctype html><html><head>${UKG_BUTTON}</head><body>${body}</body></html>`;

let browser;
try {
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    warn(`custom-element button checks skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const check = async (body) => {
      const page = await newLivenessPage(browser);
      try {
        await installLivenessRouteGuard(page);
        await page.route(POSTING_URL, (route) => route.fulfill({ contentType: 'text/html', body: html(body) }));
        return await checkUrlLiveness(page, POSTING_URL);
      } finally {
        await page.context().close();
      }
    };

    const ukg = await check(`<main>${POSTING}<ukg-button>Apply now</ukg-button></main>`);
    if (ukg.result === 'active' && ukg.code === 'apply_control_visible') {
      pass('a <ukg-button> whose label is slotted into its shadow <button> reads as an Apply control');
    } else {
      fail(`ukg-button Apply: ${JSON.stringify(ukg)}`);
    }

    // The same filter as a native control: a custom button in the page chrome
    // or a hidden one is not read, and a custom element that is not a *-button
    // is not a control at all, whatever text it carries.
    const notControls = await check([
      '<nav><ukg-button>Apply now</ukg-button></nav>',
      `<main>${POSTING}<ukg-button hidden>Apply now</ukg-button><job-card>How to apply</job-card></main>`,
    ].join(''));
    if (notControls.result === 'uncertain' && notControls.code === 'no_apply_control') {
      pass('a custom Apply button in <nav> or hidden, and "apply" in a non-button custom element, are not Apply controls');
    } else {
      fail(`custom elements that are not Apply controls: ${JSON.stringify(notControls)}`);
    }
  }
} catch (e) {
  fail(`custom-element button tests crashed: ${e.message}`);
} finally {
  await browser?.close();
}
