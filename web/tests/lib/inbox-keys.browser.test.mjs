// Live-browser regression for the inbox keys (disposable data only).
// Generate a root with node tests/fixtures/inbox-undo.mjs, start the web server
// with CAREER_OPS_ROOT set to it, then set INBOX_KEYS_TEST_URL and
// INBOX_KEYS_TEST_ROOT. tests/browser-suites.mjs does all of that.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.INBOX_KEYS_TEST_URL;
const root = process.env.INBOX_KEYS_TEST_ROOT;

test("inbox keys act on the cursor row and on checked rows", { skip: liveServerSkip("INBOX_KEYS_TEST_URL", "INBOX_KEYS_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inbox-undo-fixture"), "utf8").trim(), "fictional-only");
  const pipeline = path.join(root, "data/pipeline.md");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const row = (company) => page.locator("li").filter({ hasText: company });
  async function until(check) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 15_000) assert.fail("UI did not reach expected state");
      await page.waitForTimeout(50);
    }
  }

  await page.goto(`${origin.origin}/pipeline`);
  await row("Fixture Beta").getByRole("checkbox").waitFor();

  // With no row under the cursor, x only places the cursor. Nothing is skipped.
  await page.locator("h1").first().click();
  await page.keyboard.press("x");
  await until(async () => (await page.locator("li.ring-2").count()) === 1);
  await page.waitForTimeout(300);
  assert.ok(!fs.readFileSync(pipeline, "utf8").includes("[x]"), "x without a cursor skips nothing");

  // Focus stays on a checkbox after a click. Shift+X must still skip the checked row.
  await row("Fixture Beta").getByRole("checkbox").click();
  await page.keyboard.press("Shift+X");
  await until(() => fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-beta"));
  await until(async () => (await row("Fixture Beta").count()) === 0);
  assert.ok(fs.readFileSync(pipeline, "utf8").includes("[ ] https://example.com/fixture-alpha"));
  assert.deepEqual(errors, []);
});
