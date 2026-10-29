// Optional Chrome regression: start the local web server against disposable
// data (node tests/fixtures/blank.mjs), then
// SKIP_LINK_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.SKIP_LINK_TEST_URL;

test("The first Tab offers a skip link that moves focus past the navigation", { skip: liveServerSkip("SKIP_LINK_TEST_URL"), timeout: 180_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const errors = [];

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    for (const pathname of ["/pipeline", "/config"]) {
      const where = `${pathname} at ${viewport.width}px`;
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on("pageerror", (error) => errors.push(`${where}: ${error.message}`));
      await page.goto(`${origin.origin}${pathname}`);
      const main = page.getByRole("main");
      await main.waitFor();
      const skip = page.getByRole("link", { name: "Skip to content", exact: true });
      const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement);

      const hidden = await skip.boundingBox();
      assert.ok(!hidden || hidden.width <= 1 || hidden.height <= 1, `${where}: skip link is hidden before focus, got ${JSON.stringify(hidden)}`);

      await page.keyboard.press("Tab");
      assert.equal(await isFocused(skip), true, `${where}: the first Tab focuses the skip link`);
      const box = await skip.boundingBox();
      assert.ok(box && box.width > 1 && box.height > 1, `${where}: focused skip link has a visible box, got ${JSON.stringify(box)}`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${where}: focused skip link is inside the viewport, got ${JSON.stringify(box)}`);
      const onTop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("a")?.textContent, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      assert.equal(onTop, "Skip to content", `${where}: no other chrome covers the focused skip link`);

      await page.keyboard.press("Enter");
      assert.equal(await isFocused(main), true, `${where}: Enter moves focus to the main region`);
      assert.equal(await main.evaluate((el) => getComputedStyle(el).outlineStyle), "none", `${where}: the main region shows no focus ring`);

      await page.keyboard.press("Tab");
      const next = await main.evaluate((el) => {
        const active = document.activeElement;
        return { inMain: el !== active && el.contains(active), inNav: Boolean(active?.closest("nav")), label: active?.textContent?.trim().slice(0, 40) };
      });
      assert.equal(next.inMain, true, `${where}: the next Tab lands inside main, got ${next.label}`);
      assert.equal(next.inNav, false, `${where}: the next Tab skips the navigation links`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
});
