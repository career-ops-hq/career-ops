// tests/browser-extract-content-root.test.mjs — readDom() picks the element
// that holds the posting, not merely the first main/[role=main]/article.
// Runs readDom() against fixture HTML in headless Chromium; skipped with a
// warning when Chromium is not installed (CI installs with --ignore-scripts).
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nbrowser-extract.mjs (readDom content root)');

const JD = 'Example Corp is hiring a Platform Engineer to build and run the internal developer platform. '
  + 'You will own the deployment pipeline, write tooling in TypeScript and Go, and partner with product teams '
  + 'on reliability. Requirements: five years of backend experience and comfort with on-call.';

let browser;
try {
  const { readDom } = await import(pathToFileURL(join(ROOT, 'browser-extract.mjs')).href);
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    warn(`readDom content-root tests skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }

  if (browser) {
    const page = await browser.newPage();
    const read = async (html) => {
      await page.setContent(html);
      return readDom(page);
    };

    // A short share widget is the first <article>; the posting is the second.
    const widgetFirst = await read(`<body>
      <article><a href="#">Share this job</a></article>
      <article><h1>Platform Engineer</h1><p>${JD}</p></article>
    </body>`);
    if (widgetFirst.text.includes('internal developer platform')) pass('readDom reads the longest candidate, not a stub first <article>');
    else fail(`readDom read the stub widget: ${JSON.stringify(widgetFirst.text.slice(0, 80))}`);

    // A <main> that is mostly menu must not outrank the posting: candidates
    // are compared on their text after nav/header/footer are stripped.
    const menuMain = await read(`<body>
      <main><nav>${'Jobs · Teams · Locations · Benefits · '.repeat(15)}</nav><p>Loading…</p></main>
      <article><h1>Platform Engineer</h1><p>${JD}</p></article>
    </body>`);
    if (menuMain.text.includes('internal developer platform')) pass('readDom compares candidates after stripping nav chrome');
    else fail(`readDom picked the menu-heavy <main>: ${JSON.stringify(menuMain.text.slice(0, 80))}`);

    // CSS-hidden text must not count: a hidden candidate, or a hidden panel
    // inside one, longer than the visible posting must not outrank it.
    const hidden = 'Archived posting from a previous hiring round. '.repeat(40);
    const hiddenCandidate = await read(`<body>
      <article style="display:none"><p>${hidden}</p></article>
      <article><h1>Platform Engineer</h1><p>${JD}</p></article>
    </body>`);
    if (hiddenCandidate.text.includes('internal developer platform') && !hiddenCandidate.text.includes('Archived posting')) {
      pass('readDom ignores a hidden candidate longer than the visible posting');
    } else fail(`readDom read a hidden candidate: ${JSON.stringify(hiddenCandidate.text.slice(0, 80))}`);
    const hiddenPanel = await read(`<body>
      <main><div hidden><p>${hidden}</p></div><p>Loading…</p></main>
      <article><h1>Platform Engineer</h1><p>${JD}</p></article>
    </body>`);
    if (hiddenPanel.text.includes('internal developer platform') && !hiddenPanel.text.includes('Archived posting')) {
      pass('readDom compares rendered text, so a hidden panel does not inflate a candidate');
    } else fail(`readDom counted hidden panel text: ${JSON.stringify(hiddenPanel.text.slice(0, 80))}`);

    // Hiding the chrome for the read leaves the live page as it was.
    await read(`<body><main><nav style="color: red">Home</nav><header>Top</header><p>${JD}</p></main></body>`);
    const restored = await page.evaluate(() => [
      document.querySelector('nav').getAttribute('style'),
      document.querySelector('header').getAttribute('style'),
    ]);
    if (restored[0] === 'color: red' && restored[1] === null) pass('readDom restores the style attributes of the chrome it hid');
    else fail(`readDom left the chrome styles changed: ${JSON.stringify(restored)}`);

    // An unterminated comment in the chrome's own style must not swallow the
    // display:none that hides it for the read.
    const openComment = await read(`<body>
      <main><nav style="color: red; /* open">${'Jobs · Teams · Locations · Benefits · '.repeat(15)}</nav><p>Loading…</p></main>
      <article><h1>Platform Engineer</h1><p>${JD}</p></article>
    </body>`);
    const navStyle = await page.evaluate(() => document.querySelector('nav').getAttribute('style'));
    if (openComment.text.includes('internal developer platform') && navStyle === 'color: red; /* open') {
      pass('readDom hides chrome whose style has an unterminated comment, and restores it verbatim');
    } else fail(`readDom chrome with open comment wrong: ${JSON.stringify([openComment.text.slice(0, 80), navStyle])}`);

    // A display:contents candidate has no box of its own but renders its
    // children, so its text is still read.
    const contents = await read(`<body><main style="display:contents"><h1>Platform Engineer</h1><p>${JD}</p></main></body>`);
    if (contents.text.includes('internal developer platform')) pass('readDom reads a display:contents candidate');
    else fail(`readDom skipped a display:contents candidate: ${JSON.stringify(contents.text.slice(0, 80))}`);

    // Every candidate a stub: stay on the stub (jd mode then fails empty_text
    // and the caller falls back) rather than reading unrelated body text.
    const allStubs = await read(`<body>
      <main><p>Loading…</p></main>
      <div class="cookie-banner">${'We use cookies to improve your experience. '.repeat(10)}</div>
    </body>`);
    if (!allStubs.text.includes('cookies')) pass('readDom does not read body text when candidates exist but are stubs');
    else fail('readDom read the cookie banner as page text');

    // No candidate at all: the body is the root, as before.
    const noCandidates = await read(`<body><div><h1>Platform Engineer</h1><p>${JD}</p></div></body>`);
    if (noCandidates.text.includes('internal developer platform')) pass('readDom reads <body> when there is no main/[role=main]/article');
    else fail(`readDom body fallback wrong: ${JSON.stringify(noCandidates.text.slice(0, 80))}`);

    // A substantive <main> still wins, and nav chrome inside it is stripped.
    const normal = await read(`<body>
      <div class="sidebar">${'Related roles and other links. '.repeat(20)}</div>
      <main><nav>Home · Jobs</nav><h1>Platform Engineer</h1><p>${JD}</p></main>
    </body>`);
    if (normal.text.includes('internal developer platform') && !normal.text.includes('Related roles') && !normal.text.includes('Home · Jobs')) {
      pass('readDom keeps a substantive <main> as the root and strips its nav');
    } else fail(`readDom root for a normal page wrong: ${JSON.stringify(normal.text.slice(0, 80))}`);
  }
} catch (e) {
  fail(`readDom content-root tests crashed: ${e.message}`);
} finally {
  await browser?.close();
}
