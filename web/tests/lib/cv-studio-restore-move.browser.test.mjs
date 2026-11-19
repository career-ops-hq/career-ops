// #7343: a bullet added back with "Add back" could not be moved up or down
// among the tailored bullets. Drives the real page on a fixture whose tailored
// CV dropped one base bullet (tests/fixtures/cv-studio-restore.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CV_STUDIO_RESTORE_TEST_URL;
const root = process.env.CV_STUDIO_RESTORE_TEST_ROOT;
const restored = "s0i0r0";

test("an added-back bullet moves up among the tailored bullets and the move is saved", {
  skip: liveServerSkip("CV_STUDIO_RESTORE_TEST_URL", "CV_STUDIO_RESTORE_TEST_ROOT"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.match(fs.readFileSync(path.join(root, "cv.md"), "utf8"), /Not a real candidate/);

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/pipeline/11/cv-studio`);
  await page.getByRole("heading", { name: "Fixture Alpha", exact: true }).waitFor();
  const entry = page.locator("section[aria-label='Work Experience']");
  const order = () => entry.locator("li[data-bullet]").evaluateAll((lis) => lis.map((li) => li.getAttribute("data-bullet")));

  await entry.getByRole("button", { name: "Add back" }).click();
  const up = entry.getByRole("button", { name: "Move added-back bullet up", exact: true });
  const down = entry.getByRole("button", { name: "Move added-back bullet down", exact: true });
  await up.waitFor();
  assert.deepEqual(await order(), ["s0i0b0", "s0i0b1", restored]);
  assert.equal(await down.isDisabled(), true, "the last row cannot move down");

  await up.click();
  await up.click();
  assert.deepEqual(await order(), [restored, "s0i0b0", "s0i0b1"]);
  assert.equal(await up.isDisabled(), true, "the first row cannot move up");

  const editsPath = path.join(root, ".career-ops-web", "cv-studio", "011.json");
  const deadline = Date.now() + 8_000;
  let saved = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(editsPath)) {
      saved = JSON.parse(fs.readFileSync(editsPath, "utf8"));
      if (saved.order?.s0i0?.[0] === restored) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(saved?.order?.s0i0, [restored, "s0i0b0", "s0i0b1"]);
  assert.deepEqual(saved?.restored, { s0i0: [0] });

  // The page comes back with the bullet where it was moved, not pinned last.
  await page.reload();
  await page.getByRole("heading", { name: "Fixture Alpha", exact: true }).waitFor();
  await up.waitFor();
  assert.deepEqual(await order(), [restored, "s0i0b0", "s0i0b1"]);
  assert.deepEqual(errors, []);
});
