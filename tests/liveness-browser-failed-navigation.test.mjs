// tests/liveness-browser-failed-navigation.test.mjs — a check whose navigation
// failed does not break the checks after it on the same page.
//
// Chromium commits its error page for a failed navigation just after page.goto
// has rejected. Playwright reports a goto that is still waiting when that
// commit lands as "interrupted by another navigation" (microsoft/playwright#35944),
// and Chromium goes on loading the interrupted URL, whose late commit then
// interrupts the goto after it. check-liveness and scan --verify run every
// check on one page, so one posting whose host had no address, or whose
// connection failed, turned the checks after it into navigation_errors.
//
// The page double plays that sequence out, so the fix is checked where the
// suite runs without a browser (CI installs none). The second part runs the
// same sequences on real Chromium and is skipped with a warning where Chromium
// cannot launch. Its pages come from routes and its DNS is a stub, so nothing
// leaves the machine.
import { pass, fail, warn } from './helpers.mjs';
import { checkUrlLiveness, installLivenessRouteGuard, newLivenessPage, setHostResolver } from '../liveness-browser.mjs';

console.log('\nliveness-browser — after a failed navigation');

const POSTING_TEXT = 'Senior Analyst. Analyse data for the team. '.repeat(20);
const posting = (n) => `https://careers.example/jobs/${n}`;

// What Chromium and Playwright do, in miniature: a navigation commits 20 ms
// after its goto; a failed one rejects at once, and its error page commits
// 5 ms later, after a frame of the old page has navigated; a commit that lands
// while a goto waits for its own fails that goto as interrupted, and the
// interrupted navigation still commits. With fragmentFirst, the old page also
// changes its own fragment before the error page commits.
function chromiumLikePage({ failing = [], timingOut = [], fragmentFirst = false }) {
  let current = 'about:blank';
  const main = { url: () => current };
  const child = { url: () => 'https://widgets.example/frame' };
  const listeners = new Set();
  let waiting = null;
  const notify = (frame) => {
    for (const listener of [...listeners]) listener(frame);
  };
  const commit = (frame, url) => {
    if (frame === main) {
      current = url;
      const goto = waiting;
      waiting = null;
      if (goto?.url === url) goto.resolve({ status: () => 200 });
      else goto?.reject(new Error(`page.goto: Navigation to "${goto.url}" is interrupted by another navigation to "${url}"`));
    }
    notify(frame);
  };
  // A same-document navigation fires framenavigated too, but a goto waits for
  // a new document, so it neither completes nor interrupts one.
  const changeFragment = (fragment) => {
    current = `${current.split('#')[0]}#${fragment}`;
    notify(main);
  };
  const failNavigation = (url) => {
    if (fragmentFirst) setTimeout(() => changeFragment('apply'), 1);
    setTimeout(() => commit(child, 'https://widgets.example/frame'), 2);
    setTimeout(() => commit(main, 'chrome-error://chromewebdata/'), 5);
    throw new Error(`net::ERR_CONNECTION_FAILED at ${url}`);
  };
  return {
    mainFrame: () => main,
    url: () => current,
    async goto(url) {
      if (failing.includes(url)) failNavigation(url);
      if (timingOut.includes(url)) {
        throw Object.assign(new Error('Timeout 15000ms exceeded.'), { name: 'TimeoutError' });
      }
      setTimeout(() => commit(main, url), 20);
      return new Promise((resolve, reject) => { waiting = { url, resolve, reject }; });
    },
    async reload() { failNavigation(current); },
    waitForEvent(_event, { predicate, timeout }) {
      return new Promise((resolve, reject) => {
        const listener = (frame) => {
          if (predicate && !predicate(frame)) return;
          listeners.delete(listener);
          clearTimeout(timer);
          resolve(frame);
        };
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error(`Timeout ${timeout}ms exceeded.`));
        }, timeout);
        listeners.add(listener);
      });
    },
    async waitForTimeout() {},
    // A BambooHR page that never renders, so the check reloads it.
    async evaluate(fn) {
      const blank = current.includes('bamboohr');
      if (String(fn).includes('querySelectorAll')) return blank ? [] : ['Apply now'];
      return blank ? '' : POSTING_TEXT;
    },
  };
}

async function codes(page, urls) {
  const out = [];
  for (const url of urls) out.push((await checkUrlLiveness(page, url)).code);
  return out;
}

function expectCodes(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass(label);
  else fail(`${label}: got ${got.join(', ')} (want ${want.join(', ')})`);
}

const failed = 'https://unreachable.example/jobs/1';
const failedToo = 'https://unreachable.example/jobs/2';
const bamboo = 'https://acme.bamboohr.com/careers/7';
const timedOut = 'https://slow.example/jobs/1';

expectCodes(
  'the postings after a failed navigation read active',
  await codes(chromiumLikePage({ failing: [failed] }), [failed, posting(1), posting(2)]),
  ['navigation_error', 'apply_control_visible', 'apply_control_visible'],
);
expectCodes(
  'two failed navigations in a row, then a posting that reads active',
  await codes(chromiumLikePage({ failing: [failed, failedToo] }), [failed, failedToo, posting(1)]),
  ['navigation_error', 'navigation_error', 'apply_control_visible'],
);
expectCodes(
  'the old page changing its fragment does not end the wait before the error page',
  await codes(chromiumLikePage({ failing: [failed], fragmentFirst: true }), [posting(1), failed, posting(2)]),
  ['apply_control_visible', 'navigation_error', 'apply_control_visible'],
);
expectCodes(
  'a failed BambooHR reload does not break the check after it',
  await codes(chromiumLikePage({}), [bamboo, posting(1)]),
  ['bamboohr_render_retry_failed', 'apply_control_visible'],
);

// A timeout has no error page to wait for: the next goto cancels the
// navigation it left. Waiting would only add the full bound to the check.
{
  const page = chromiumLikePage({ timingOut: [timedOut] });
  const started = Date.now();
  const first = await checkUrlLiveness(page, timedOut);
  const ms = Date.now() - started;
  const next = await checkUrlLiveness(page, posting(1));
  if (first.code === 'navigation_error' && ms < 1000 && next.code === 'apply_control_visible') {
    pass('a timed-out navigation returns without waiting for a commit');
  } else {
    fail(`timed-out navigation: ${first.code} after ${ms} ms, then ${next.code} (want navigation_error under 1000 ms, then apply_control_visible)`);
  }
}

// The same sequences on Chromium itself.
const POSTING_HTML = `<!doctype html><html><body><main><h1>Senior Analyst</h1><p>${POSTING_TEXT}</p><button>Apply now</button></main></body></html>`;
let browser;
try {
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    warn(`failed-navigation checks on Chromium skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    // gone.example has no address, so the guard refuses the page itself.
    const restore = setHostResolver(async (host) => (host === 'gone.example' ? [] : ['93.184.216.34']));
    let page;
    try {
      page = await newLivenessPage(browser);
      await installLivenessRouteGuard(page);
      await page.route('https://careers.example/**', (route) => route.fulfill({ contentType: 'text/html', body: POSTING_HTML }));
      await page.route('https://unreachable.example/**', (route) => route.abort('connectionfailed'));
      const gone = 'https://gone.example/jobs/1';
      expectCodes(
        'Chromium: the postings after a page the guard refused read active',
        await codes(page, [gone, posting(1), posting(2)]),
        ['dns_no_addresses', 'apply_control_visible', 'apply_control_visible'],
      );
      expectCodes(
        'Chromium: the postings after a failed connection read active',
        await codes(page, [failed, posting(3), posting(4)]),
        ['navigation_error', 'apply_control_visible', 'apply_control_visible'],
      );
      expectCodes(
        'Chromium: two refused pages in a row, then a posting that reads active',
        await codes(page, [gone, gone, posting(5)]),
        ['dns_no_addresses', 'dns_no_addresses', 'apply_control_visible'],
      );
    } finally {
      // A leaked stub would answer for every later suite in this process.
      restore();
      await page?.context().close();
    }
  }
} catch (e) {
  fail(`failed-navigation tests on Chromium crashed: ${e.message}`);
} finally {
  await browser?.close();
}
