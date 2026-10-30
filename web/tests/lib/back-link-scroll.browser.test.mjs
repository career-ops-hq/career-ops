// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/pipeline-long.mjs as CAREER_OPS_ROOT for a local server.
// Set BACK_SCROLL_TEST_URL and BACK_SCROLL_TEST_ROOT to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.BACK_SCROLL_TEST_URL;
const root = process.env.BACK_SCROLL_TEST_ROOT;

test("The in-page back link returns to the list where it was left", { skip: liveServerSkip("BACK_SCROLL_TEST_URL", "BACK_SCROLL_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".pipeline-long-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const back = () => page.getByRole("link", { name: "Pipeline", exact: true }).filter({ has: page.locator("svg.lucide-arrow-left") });
  const rows = page.locator("tbody tr");
  const query = "tab=ALL&sort=tracker&dir=1";

  await page.goto(`${origin.origin}/pipeline?${query}`);
  const company = page.getByRole("link", { name: "Fixture Company 60", exact: true });
  await company.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  assert.ok(before > 1000, `the list scrolled to row 60 (scrollY ${before})`);
  await company.click();
  await page.getByRole("heading", { name: "Fixture Company 60", exact: true }).waitFor();
  await back().click();
  await company.waitFor();
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 50, before, { timeout: 5_000 }).catch(() => {});
  const after = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(after - before) < 50, `scrollY ${after} returned to ${before}`);
  assert.equal(new URL(page.url()).search.slice(1), query);

  await page.goto(`${origin.origin}/pipeline/5`);
  await back().click();
  await page.waitForURL((u) => u.pathname === "/pipeline");
  await page.getByRole("heading", { name: "Pipeline", exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, "");
  assert.equal(await page.evaluate(() => window.scrollY), 0);

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=company&dir=1`);
  await rows.nth(0).getByRole("checkbox").check();
  await rows.nth(1).getByRole("checkbox").check();
  await page.getByRole("link", { name: "Compare", exact: true }).click();
  await page.getByRole("heading", { name: "Compare" }).waitFor();
  assert.equal(await back().getAttribute("href"), "/pipeline?tab=ALL&sort=company&dir=1");
  await back().click();
  await page.waitForURL((u) => u.pathname === "/pipeline" && u.search === "?tab=ALL&sort=company&dir=1");
  assert.equal(new URL(page.url()).search, "?tab=ALL&sort=company&dir=1");
  assert.deepEqual(errors, []);
});
