// Live-browser check for saved pipeline views (disposable data only).
// Generate a root with node tests/fixtures/pipeline-status.mjs, start the web
// server with CAREER_OPS_ROOT set to it, then set PIPELINE_VIEWS_TEST_URL and
// PIPELINE_VIEWS_TEST_ROOT. tests/browser-suites.mjs does all of that.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.PIPELINE_VIEWS_TEST_URL;
const root = process.env.PIPELINE_VIEWS_TEST_ROOT;

test("a saved view with a score floor comes back after a reload", { skip: liveServerSkip("PIPELINE_VIEWS_TEST_URL", "PIPELINE_VIEWS_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rows = page.locator("tbody tr");
  async function until(check) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 15_000) assert.fail("UI did not reach expected state");
      await page.waitForTimeout(50);
    }
  }

  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await until(async () => (await rows.count()) === 3);
  await page.getByRole("combobox", { name: "Minimum score" }).selectOption("4");
  await until(async () => (await rows.count()) === 1 && new URL(page.url()).searchParams.get("min") === "4");

  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Top picks");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Top picks", exact: true }).waitFor();

  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await until(async () => (await rows.count()) === 3);
  await page.getByRole("button", { name: "Top picks", exact: true }).click();
  await until(async () => (await rows.count()) === 1);
  assert.equal(new URL(page.url()).searchParams.get("min"), "4");
  assert.match(await rows.first().innerText(), /Fixture Alpha/);

  await page.getByRole("button", { name: "Remove view Top picks" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Save view", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Top picks", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});
