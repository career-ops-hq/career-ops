import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CV_EDITOR_KEEP_TEST_URL;
const root = process.env.CV_EDITOR_KEEP_TEST_ROOT;

test("an edit to the CV stays on disk after leaving the page, and the status does not say Saved while it is dirty", {
  skip: liveServerSkip("CV_EDITOR_KEEP_TEST_URL", "CV_EDITOR_KEEP_TEST_ROOT"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  const cvPath = path.join(root, "cv.md");
  const original = fs.readFileSync(cvPath, "utf8");
  assert.match(original, /Not a real candidate/);

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/cv`);
  const box = page.locator("textarea");
  await box.waitFor();
  const status = () => page.getByRole("status").filter({ hasText: /^(?:Unsaved|Saving|Saved)$/ });

  const first = `${original.trimEnd()}\n\nKept the Tuesday review.`;
  await box.fill(first);
  await status().filter({ hasText: /^Unsaved$/ }).waitFor();
  await status().filter({ hasText: /^Saved$/ }).waitFor({ timeout: 8_000 });
  assert.match(fs.readFileSync(cvPath, "utf8"), /Kept the Tuesday review\./);
  const backupsAfterFirst = fs.readdirSync(root).filter((name) => name.startsWith("cv.md.bak-"));
  assert.equal(backupsAfterFirst.length, 1);

  const second = `${first}\nStill editing.`;
  await box.fill(second);
  assert.equal((await status().innerText()).trim(), "Unsaved");
  await page.getByRole("complementary").getByRole("link", { name: "Today", exact: true }).click();
  await page.waitForURL((next) => new URL(next).pathname === "/");

  const deadline = Date.now() + 8_000;
  let disk = "";
  while (Date.now() < deadline) {
    disk = fs.readFileSync(cvPath, "utf8");
    if (disk.includes("Still editing.")) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(disk, /Still editing\./);
  const backupsAfterLeave = fs.readdirSync(root).filter((name) => name.startsWith("cv.md.bak-"));
  assert.ok(backupsAfterLeave.length <= 2, `backups ${backupsAfterLeave.length}`);

  await page.goto(`${origin.origin}/cv`);
  await box.waitFor();
  await page.locator("textarea", { hasText: "Still editing." }).waitFor();
  assert.match(await box.inputValue(), /Still editing\./);
  await status().filter({ hasText: /^Saved$/ }).waitFor({ timeout: 8_000 });
  assert.deepEqual(errors, []);
});
