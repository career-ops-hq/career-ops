import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CV_STUDIO_KEEP_TEST_URL;
const root = process.env.CV_STUDIO_KEEP_TEST_ROOT;
const section0Item0Bullet0 = "s0i0b0";

test("hiding a bullet and leaving the studio keeps the hide, and the status does not say Saved while it is dirty", {
  skip: liveServerSkip("CV_STUDIO_KEEP_TEST_URL", "CV_STUDIO_KEEP_TEST_ROOT"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.match(fs.readFileSync(path.join(root, "cv.md"), "utf8"), /Not a real candidate/);
  assert.match(fs.readFileSync(path.join(root, "output", "cv-fixture-alpha-2026-10-28.html"), "utf8"), /Not a real candidate/);

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/pipeline/11/cv-studio`);
  await page.getByRole("heading", { name: "Fixture Alpha", exact: true }).waitFor();
  const status = () => page.getByRole("status").filter({ hasText: /^(?:Unsaved|Saving|Saved)$/ });
  await status().filter({ hasText: /^Saved$/ }).waitFor();

  await page.getByRole("button", { name: "Hide bullet", exact: true }).click();
  assert.equal((await status().innerText()).trim(), "Unsaved");
  await page.getByRole("complementary").getByRole("link", { name: "Today", exact: true }).click();
  await page.waitForURL((next) => new URL(next).pathname === "/");

  const editsPath = path.join(root, ".career-ops-web", "cv-studio", "011.json");
  const deadline = Date.now() + 8_000;
  let hidden = [];
  while (Date.now() < deadline) {
    if (fs.existsSync(editsPath)) {
      hidden = JSON.parse(fs.readFileSync(editsPath, "utf8")).hidden ?? [];
      if (hidden.length > 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(hidden, [section0Item0Bullet0]);

  await page.goto(`${origin.origin}/pipeline/11/cv-studio`);
  await page.getByRole("button", { name: "Show bullet", exact: true }).waitFor();
  await status().filter({ hasText: /^Saved$/ }).waitFor({ timeout: 8_000 });
  assert.deepEqual(errors, []);
});
