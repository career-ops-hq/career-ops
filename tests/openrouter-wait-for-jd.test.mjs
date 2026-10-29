// tests/openrouter-wait-for-jd.test.mjs — openrouter-runner waits for a slow
// single-page app to render the job description instead of reading the page
// after a fixed 2 s.
//
// A page that adds its description 3 s after load used to come back as its
// loading shell and was rejected as unreadable. waitForJobText waits until the
// body holds real text (up to 15 s). Text in nav/header/footer does not count:
// the read strips it, so a long nav must not end the wait early.
//
// Run:  node --test tests/openrouter-wait-for-jd.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { waitForJobText } from '../openrouter-runner.mjs';
import { toolRequired } from './required-tools.mjs';

const SENTENCE =
  'You will own the internal deploy pipeline across three regions, review infrastructure changes, ' +
  'and mentor two engineers working on production systems. ';
const JD = ('Senior Platform Engineer at Acme Corp. ' + SENTENCE.repeat(30)).slice(0, 3000);

const PAGE = `<!doctype html><html><head><title>Job</title></head><body>
<div id="app">Loading...</div>
<script>
  setTimeout(() => {
    document.getElementById('app').textContent = ${JSON.stringify(JD)};
  }, 3000);
</script></body></html>`;

// Needs a real Chromium: skip where none is installed (the plain test job),
// except under `test-all.mjs --needs browser`, where a missing browser fails.
let browser;
let launchError = null;

before(async () => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    launchError = err;
  }
});

after(async () => {
  await browser?.close().catch(() => {});
});

test('waitForJobText waits for a job description that renders after 3 s', { timeout: 60_000 }, async (t) => {
  if (launchError) {
    if (toolRequired('browser')) throw launchError;
    t.skip('no Chromium');
    return;
  }
  const page = await browser.newPage();
  await page.setContent(PAGE);
  await waitForJobText(page);
  const text = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
  assert.ok(text.length >= 2500, `expected the rendered description, got ${text.length} chars: ${text.slice(0, 80)}`);
  assert.ok(text.includes('Senior Platform Engineer at Acme Corp.'));
});

// The wait counts what the read keeps. A page whose nav alone is over 1500
// chars while the description still says "Loading..." used to end the wait at
// once; the read then stripped the nav and saw only the loading shell.
const NAV_PAGE = `<!doctype html><html><head><title>Job</title></head><body>
<nav>${'Products Solutions Pricing Company Careers Contact '.repeat(50)}</nav>
<main><div id="app">Loading...</div></main>
<footer>${'Privacy Terms Cookies Accessibility '.repeat(50)}</footer>
<script>
  setTimeout(() => {
    document.getElementById('app').textContent = ${JSON.stringify(JD)};
  }, 3000);
</script></body></html>`;

test('waitForJobText ignores nav/footer text and leaves the page as it was', { timeout: 60_000 }, async (t) => {
  if (launchError) {
    if (toolRequired('browser')) throw launchError;
    t.skip('no Chromium');
    return;
  }
  const page = await browser.newPage();
  await page.setContent(NAV_PAGE);
  await waitForJobText(page);
  const state = await page.evaluate(() => ({
    navKept: !!document.querySelector('nav') && !!document.querySelector('footer'),
    main: (document.querySelector('main')?.innerText || '').trim(),
  }));
  assert.ok(state.navKept, 'waiting must not remove nav/footer from the live page');
  assert.ok(state.main.length >= 2500, `waited only until "${state.main.slice(0, 40)}" (${state.main.length} chars)`);
  assert.ok(state.main.includes('Senior Platform Engineer at Acme Corp.'));
});

// Text a visitor cannot see does not count: the read takes innerText, which
// drops it. 3,000+ chars in a display:none block (and a visibility:hidden one)
// next to a visible "Loading..." must not end the wait.
const HIDDEN_PAGE = `<!doctype html><html><head><title>Job</title></head><body>
<div style="display:none">${'Hidden filler text for another tab. '.repeat(100)}</div>
<div style="visibility:hidden">${'Invisible filler text for a collapsed panel. '.repeat(100)}</div>
<div id="app">Loading...</div>
<script>
  setTimeout(() => {
    document.getElementById('app').textContent = ${JSON.stringify(JD)};
  }, 3000);
</script></body></html>`;

test('waitForJobText ignores display:none and visibility:hidden text', { timeout: 60_000 }, async (t) => {
  if (launchError) {
    if (toolRequired('browser')) throw launchError;
    t.skip('no Chromium');
    return;
  }
  const page = await browser.newPage();
  await page.setContent(HIDDEN_PAGE);
  await waitForJobText(page);
  const text = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
  assert.ok(text.includes('Senior Platform Engineer at Acme Corp.'), `waited only until "${text.slice(0, 40)}" (${text.length} chars)`);
});

// The count stays inside the main content. A visible consent panel outside
// <main> (not a nav/header/footer) must not end the wait while <main> still
// says "Loading...".
const CONSENT_PAGE = `<!doctype html><html><head><title>Job</title></head><body>
<div id="consent">${'We use cookies to improve your experience and to measure traffic. '.repeat(40)}</div>
<main><div id="app">Loading...</div></main>
<script>
  setTimeout(() => {
    document.getElementById('app').textContent = ${JSON.stringify(JD)};
  }, 3000);
</script></body></html>`;

test('waitForJobText counts the main content, not a consent panel outside it', { timeout: 60_000 }, async (t) => {
  if (launchError) {
    if (toolRequired('browser')) throw launchError;
    t.skip('no Chromium');
    return;
  }
  const page = await browser.newPage();
  await page.setContent(CONSENT_PAGE);
  await waitForJobText(page);
  const main = await page.evaluate(() => (document.querySelector('main')?.innerText || '').trim());
  assert.ok(main.includes('Senior Platform Engineer at Acme Corp.'), `waited only until "${main.slice(0, 40)}" (${main.length} chars)`);
});
