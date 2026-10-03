// tests/liveness-headed-page-provider.test.mjs — createHeadedPageProvider must not
// keep handing back a headed page after its browser has gone away.
//
// Regression for #4176: get() cached the page and returned it unconditionally, so
// once the headed Chromium closed mid-run every later anti-bot retry ran against a
// dead page and came back "navigation error: Target page, context or browser has
// been closed" rather than a real verdict. The headless path was unaffected, so
// nothing in the output showed the fallback had stopped working.
import { pass, fail } from './helpers.mjs';
import { createHeadedPageProvider } from '../liveness-browser.mjs';

console.log('\nliveness-browser — createHeadedPageProvider drops a closed page');

// Minimal stand-ins for the Playwright objects the provider touches.
const makeChromium = () => {
  const launched = [];
  const chromium = {
    launches: launched,
    async launch() {
      const browser = {
        connected: true,
        isConnected: () => browser.connected,
        async newContext() {
          return {
            async newPage() {
              const page = { closed: false, isClosed: () => page.closed, browser };
              browser.page = page;
              return page;
            },
          };
        },
        async close() {
          browser.connected = false;
          if (browser.page) browser.page.closed = true;
        },
      };
      launched.push(browser);
      return browser;
    },
  };
  return chromium;
};

// 1. A live page is still reused, so the cache keeps working.
{
  const chromium = makeChromium();
  const provider = createHeadedPageProvider(chromium);
  const first = await provider.get();
  const second = await provider.get();

  first === second && chromium.launches.length === 1
    ? pass('a live page is reused without relaunching')
    : fail('a live page should be reused from the cache');
}

// 2. The reported bug: page closed mid-run.
{
  const chromium = makeChromium();
  const provider = createHeadedPageProvider(chromium);
  const first = await provider.get();
  first.closed = true; // the headed window went away

  const second = await provider.get();

  second && second !== first && second.isClosed() === false
    ? pass('a closed page is replaced rather than handed back')
    : fail('get() returned the closed page again (the #4176 bug)');
}

// 3. The browser disconnecting counts too, even if the page handle looks open.
{
  const chromium = makeChromium();
  const provider = createHeadedPageProvider(chromium);
  const first = await provider.get();
  chromium.launches[0].connected = false; // browser died, page handle untouched

  const second = await provider.get();

  second && second !== first
    ? pass('a disconnected browser is replaced rather than reused')
    : fail('get() reused a page whose browser had disconnected');
}

// 4. If relaunching is impossible, get() returns null rather than a dead page.
//    checkUrlLivenessWithFallback already treats null as "no headed retry" and
//    keeps the headless result, so this degrades cleanly.
{
  let calls = 0;
  const chromium = {
    async launch() {
      calls += 1;
      if (calls === 1) {
        const browser = {
          isConnected: () => true,
          async newContext() {
            return { async newPage() { return { isClosed: () => true }; } };
          },
          async close() {},
        };
        return browser;
      }
      throw new Error('no display available');
    },
  };
  const provider = createHeadedPageProvider(chromium);
  await provider.get();       // caches a page that reports itself closed
  const second = await provider.get();

  second === null
    ? pass('returns null when the page is dead and a relaunch fails')
    : fail('should return null rather than a dead page when relaunch fails');
}

// 5. A closed page whose browser is still connected must not orphan that browser:
//    close() only knows the current handle, so the stale one is torn down before
//    the replacement is launched.
{
  const chromium = makeChromium();
  const provider = createHeadedPageProvider(chromium);
  const first = await provider.get();
  first.closed = true; // window gone, Chromium process still up

  const second = await provider.get();
  const stale = chromium.launches[0];

  second && second !== first && stale.connected === false && chromium.launches.length === 2
    ? pass('a stale browser is closed before its replacement is launched')
    : fail('get() replaced the page but left the previous browser running');
}
