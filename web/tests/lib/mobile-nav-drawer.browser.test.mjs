// Optional browser regression: start a loopback server against disposable data
// (node tests/fixtures/blank.mjs), then set MOBILE_NAV_TEST_URL to run this suite.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.MOBILE_NAV_TEST_URL;

// Chrome draws a blur out to three standard deviations, which is 1.5 times the blur radius.
function drawerLeftPaintEdge() {
  const el = document.querySelector('[role="dialog"][aria-label="Navigation menu"]');
  const rect = el.getBoundingClientRect();
  let left = rect.left;
  const shadow = getComputedStyle(el).boxShadow;
  if (shadow !== "none") {
    for (const part of shadow.split(/,(?![^(]*\))/)) {
      const [x = 0, , blur = 0, spread = 0] = [...part.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      left = Math.min(left, rect.left + x - spread - 1.5 * blur);
    }
  }
  return { left, width: rect.width, viewport: document.documentElement.clientWidth };
}

test("mobile navigation drawer stays out of the viewport until opened", { skip: liveServerSkip("MOBILE_NAV_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const drawer = page.getByRole("dialog", { name: "Navigation menu", includeHidden: true });
  const opener = page.getByRole("button", { name: "Open menu", exact: true });

  await page.goto(`${origin.origin}/`);
  await drawer.waitFor({ state: "attached" });
  assert.equal(await drawer.boundingBox(), null, "no drawer box at desktop width");

  await page.setViewportSize({ width: 390, height: 844 });
  await opener.waitFor();
  const closed = await page.evaluate(drawerLeftPaintEdge);
  assert.ok(closed.width > 0, "drawer is laid out on a phone");
  assert.ok(closed.left >= closed.viewport, `closed drawer paints from x=${closed.left} in a ${closed.viewport}px viewport`);

  await opener.click();
  await page.waitForFunction(() => {
    const r = document.querySelector('[role="dialog"][aria-label="Navigation menu"]').getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.right <= document.documentElement.clientWidth;
  });
  assert.equal(await opener.getAttribute("aria-expanded"), "true");
  const open = page.getByRole("dialog", { name: "Navigation menu" });
  const link = open.getByRole("link").first();
  await link.focus();
  assert.ok(await link.evaluate((el) => el === document.activeElement), "a nav link takes focus");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const r = document.querySelector('[role="dialog"][aria-label="Navigation menu"]').getBoundingClientRect();
    return r.left >= document.documentElement.clientWidth;
  });
  assert.equal(await opener.getAttribute("aria-expanded"), "false");
  await page.waitForTimeout(500);
  const reclosed = await page.evaluate(drawerLeftPaintEdge);
  assert.ok(reclosed.left >= reclosed.viewport, `drawer closed by Escape paints from x=${reclosed.left}`);

  await opener.click();
  await page.waitForFunction(() => document.body.style.overflow === "hidden");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.body.style.overflow !== "hidden");
  assert.equal(await page.locator("body").evaluate((el) => el.style.overflow), "", "widening to desktop releases the scroll lock");
  // At desktop width the opener is md:hidden, so it is out of the accessibility tree.
  const hiddenOpener = page.getByRole("button", { name: "Open menu", exact: true, includeHidden: true });
  assert.equal(await hiddenOpener.getAttribute("aria-expanded"), "false");
  assert.deepEqual(errors, []);
});
