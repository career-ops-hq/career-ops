// lib/hardened-chromium.mjs — the `chromium` every launch that loads
// third-party pages imports, instead of Playwright's own.
//
// It is Playwright's chromium with one difference: launch() and
// launchPersistentContext() send all of the browser's traffic through the
// egress filter in lib/egress-proxy.mjs, which checks every connection,
// redirect hops included, against the provider layer's address list. A
// page.route() guard cannot do that alone: it never sees a redirect hop.
//
// Swapping the import keeps every launch line, its options and its test doubles
// as they were. Pages that render local files only (generate-pdf.mjs,
// img-to-pdf.mjs) keep Playwright's chromium: they load nothing from the
// network, and their file:// navigation does not go through a proxy anyway.
//
// Importing this module imports Playwright, so a caller that falls back when
// Playwright is not installed still does: the import fails the same way.

import { chromium as playwrightChromium } from 'playwright';
import { egressLaunchOptions } from './egress-proxy.mjs';

const GUARDED = {
  launch: (target) => async (options) => target.launch(await egressLaunchOptions(options)),
  launchPersistentContext: (target) => async (userDataDir, options) =>
    target.launchPersistentContext(userDataDir, await egressLaunchOptions(options)),
};

export const chromium = new Proxy(playwrightChromium, {
  get(target, prop) {
    if (Object.prototype.hasOwnProperty.call(GUARDED, prop)) return GUARDED[prop](target);
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
