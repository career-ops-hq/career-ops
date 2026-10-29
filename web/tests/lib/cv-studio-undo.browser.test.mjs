import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CV_STUDIO_UNDO_TEST_URL;
const root = process.env.CV_STUDIO_UNDO_TEST_ROOT;
const section0Item0Bullet0 = "s0i0b0";

test("undo puts a hidden bullet back and the saved edits do not keep the hide", {
  skip: liveServerSkip("CV_STUDIO_UNDO_TEST_URL", "CV_STUDIO_UNDO_TEST_ROOT"),
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
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.waitFor();
  assert.equal(await undo.isDisabled(), true);

  const editsPath = path.join(root, ".career-ops-web", "cv-studio", "011.json");
  const hiddenNow = () => {
    if (!fs.existsSync(editsPath)) return null;
    return JSON.parse(fs.readFileSync(editsPath, "utf8")).hidden ?? [];
  };
  const waitForHide = async (accept) => {
    const deadline = Date.now() + 8_000;
    let hidden = hiddenNow();
    while (Date.now() < deadline) {
      hidden = hiddenNow();
      if (accept(hidden)) return hidden;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return hidden;
  };

  // Undo before autosave writes. A missing file is not a saved hide. A hide that
  // lands late still has to be gone before the wait ends.
  await page.getByRole("button", { name: "Hide bullet", exact: true }).click();
  await page.getByRole("button", { name: "Show bullet", exact: true }).waitFor();
  await undo.click();
  await page.getByRole("button", { name: "Hide bullet", exact: true }).waitFor();
  const deadline = Date.now() + 8_000;
  let sawHide = false;
  let hidden = hiddenNow();
  while (Date.now() < deadline) {
    hidden = hiddenNow();
    if (Array.isArray(hidden) && hidden.includes(section0Item0Bullet0)) sawHide = true;
    if (sawHide && Array.isArray(hidden) && !hidden.includes(section0Item0Bullet0)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(hidden === null || !hidden.includes(section0Item0Bullet0));

  // Undo after the hide is on disk. The stored edits have to drop it.
  await page.getByRole("button", { name: "Hide bullet", exact: true }).click();
  await page.getByRole("button", { name: "Show bullet", exact: true }).waitFor();
  const stored = await waitForHide((value) => Array.isArray(value) && value.includes(section0Item0Bullet0));
  assert.deepEqual(stored, [section0Item0Bullet0]);
  await undo.click();
  await page.getByRole("button", { name: "Hide bullet", exact: true }).waitFor();
  const cleared = await waitForHide((value) => Array.isArray(value) && !value.includes(section0Item0Bullet0));
  assert.deepEqual(cleared, []);
  assert.deepEqual(errors, []);
});

test("undo then leaving keeps the restored edits after the older hide lands", {
  skip: liveServerSkip("CV_STUDIO_UNDO_TEST_URL", "CV_STUDIO_UNDO_TEST_ROOT"),
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
  const status = () => page.getByRole("status").filter({ hasText: /^(?:Unsaved|Saving|Saved)$/ });
  await status().filter({ hasText: /^Saved$/ }).waitFor();

  // Hold the hide on the wire, undo, then fire pagehide without navigating.
  // A real navigation aborts that held request, so the older hide would never
  // reach the server and could not overwrite the exit write.
  let releaseHide;
  const hideHeld = new Promise((resolve) => { releaseHide = resolve; });
  let markHide;
  const hideSeen = new Promise((resolve) => { markHide = resolve; });
  let hideSettled;
  const hideDone = new Promise((resolve) => { hideSettled = resolve; });
  let markExit;
  const exitSeen = new Promise((resolve) => { markExit = resolve; });
  let puts = 0;
  let hidePayload = "";
  let exitPayload = "";
  let heldRequest;
  let exitResponse;
  await page.route("**/api/cv-studio/**", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    puts += 1;
    if (puts === 1) {
      hidePayload = route.request().postData() ?? "";
      heldRequest = route.request();
      markHide();
      await hideHeld;
      try {
        await route.continue();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("already handled")) throw error;
      } finally {
        hideSettled();
      }
      return;
    }
    if (puts === 2) {
      exitPayload = route.request().postData() ?? "";
      const request = route.request();
      exitResponse = page.waitForResponse((res) => res.request() === request);
    }
    await route.continue();
    markExit();
  });

  await page.getByRole("button", { name: "Hide bullet", exact: true }).click();
  await hideSeen;
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Hide bullet", exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const exitOrTimeout = await Promise.race([
    exitSeen.then(() => "exit"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 8_000)),
  ]);
  assert.equal(exitOrTimeout, "exit");

  const hiddenOf = (payload) => JSON.parse(payload).edits.hidden ?? [];
  assert.ok(hiddenOf(hidePayload).includes(section0Item0Bullet0));
  assert.ok(!hiddenOf(exitPayload).includes(section0Item0Bullet0));

  const editsPath = path.join(root, ".career-ops-web", "cv-studio", "011.json");
  const hiddenNow = () => JSON.parse(fs.readFileSync(editsPath, "utf8")).hidden ?? [];
  // The earlier test can leave an empty hidden list. Wait until this exit
  // response is back, so that leftover file cannot pass the check early.
  assert.ok(exitResponse);
  await exitResponse;
  assert.ok(fs.existsSync(editsPath));
  assert.ok(!hiddenNow().includes(section0Item0Bullet0));

  const hideResponse = page.waitForResponse((res) => res.request() === heldRequest);
  releaseHide();
  await hideResponse;
  await hideDone;
  await page.unroute("**/api/cv-studio/**");
  assert.ok(!hiddenNow().includes(section0Item0Bullet0));
  assert.deepEqual(errors, []);
});
