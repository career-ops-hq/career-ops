// Live-browser regression for the tracker status keys (disposable data only).
// Generate a root with node tests/fixtures/pipeline-status.mjs, start the web
// server with CAREER_OPS_ROOT set to it, then set TRACKER_KEYS_TEST_URL and
// TRACKER_KEYS_TEST_ROOT. tests/browser-suites.mjs does all of that.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.TRACKER_KEYS_TEST_URL;
const root = process.env.TRACKER_KEYS_TEST_ROOT;

test("shift-click two rows, then a number key sets their status", { skip: liveServerSkip("TRACKER_KEYS_TEST_URL", "TRACKER_KEYS_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const tracker = path.join(root, "data/applications.md");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const row = (n) => page.locator("tbody tr").filter({ has: page.getByRole("link", { name: `#${n}`, exact: true }) });
  const statusOf = (n) => fs.readFileSync(tracker, "utf8").split("\n").find((line) => line.startsWith(`| ${n} |`))?.split("|")[6]?.trim();
  async function until(check) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 15_000) assert.fail("UI did not reach expected state");
      await page.waitForTimeout(50);
    }
  }

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=1`);
  await row(13).getByRole("checkbox").waitFor();
  const scrollBefore = await page.evaluate(() => window.scrollY);

  // Focus stays on the checkbox after a click. The number key must still work there.
  await row(11).getByRole("checkbox").click();
  await row(13).getByRole("checkbox").click({ modifiers: ["Shift"] });
  for (const n of [11, 12, 13]) assert.equal(await row(n).getByRole("checkbox").isChecked(), true, `#${n} is in the shift-click range`);
  await page.keyboard.press("6");
  await until(() => [11, 12, 13].every((n) => statusOf(n) === "Rejected"));

  // Arrow keys keep scrolling the page; j and k move the row cursor.
  await page.locator("h1").first().click();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator('[data-tracker-cursor="true"]').count(), 0, "ArrowDown does not move the row cursor");
  await page.keyboard.press("j");
  await until(async () => (await page.locator('[data-tracker-cursor="true"]').count()) === 1);
  assert.ok(scrollBefore >= 0);
  assert.deepEqual(errors, []);
});
