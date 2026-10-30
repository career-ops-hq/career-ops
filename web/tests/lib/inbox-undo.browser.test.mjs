// Optional browser regression. Generate a disposable root with
// node tests/fixtures/inbox-undo.mjs and use it as CAREER_OPS_ROOT for the server.
// Set INBOX_UNDO_TEST_URL and INBOX_UNDO_TEST_ROOT when running this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.INBOX_UNDO_TEST_URL;
const root = process.env.INBOX_UNDO_TEST_ROOT;

test("Inbox Undo remains retryable after failure", { skip: liveServerSkip("INBOX_UNDO_TEST_URL", "INBOX_UNDO_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inbox-undo-fixture"), "utf8").trim(), "fictional-only");
  const pipeline = path.join(root, "data/pipeline.md");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let release = () => {};
  t.after(async () => { release(); await page.unrouteAll({ behavior: "wait" }); await browser.close(); });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const row = (company) => page.locator("li").filter({ hasText: company });
  const undo = () => page.getByRole("button", { name: "Undo", exact: true });
  const retry = () => page.getByRole("button", { name: "Retry undo", exact: true });
  const writeAlerts = () => page.getByRole("alert").filter({ hasText: /Could not skip|Some jobs could not be restored|Fixture .* busy/ });
  async function until(check) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 15_000) assert.fail("UI did not reach expected state");
      await page.waitForTimeout(50);
    }
  }
  // Warm the endpoint and reset this disposable fixture before the five-second
  // Undo window starts; a cold dev compilation is not part of the interaction.
  for (const company of ["alpha", "beta"]) {
    const response = await page.request.post(`${origin.origin}/api/inbox/skip`, { data: { url: `https://example.com/fixture-${company}`, done: false } });
    assert.equal(response.ok(), true);
  }
  await page.goto(`${origin.origin}/pipeline`);

  let restores = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/inbox/skip", async (route) => {
    if (route.request().postDataJSON().done !== false) return route.continue();
    restores++;
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture pipeline busy" }) });
  });
  await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").click({ noWaitAfter: true });
  await undo().focus();
  await page.keyboard.press("Enter");
  const pending = page.getByRole("button", { name: "Undoing…", exact: true });
  await pending.waitFor();
  assert.equal(await pending.isDisabled(), true);
  await page.waitForTimeout(5200); // the original toast timeout must not hide a pending restore
  assert.equal(await pending.isVisible(), true);
  release();
  await page.getByRole("alert").filter({ hasText: "Fixture pipeline busy" }).waitFor();
  assert.equal(await retry().isEnabled(), true);
  assert.equal(restores, 1);
  assert.ok(fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-alpha"));
  await page.waitForTimeout(5200); // failures do not expire before the user can retry
  assert.equal(await retry().isVisible(), true);
  await page.unroute("**/api/inbox/skip");
  await retry().click();
  await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").waitFor();
  assert.ok(fs.readFileSync(pipeline, "utf8").includes("[ ] https://example.com/fixture-alpha"));
  assert.equal(await retry().count(), 0);

  // The last Skip refreshes the inbox to zero rows. Its Undo must stay mounted.
  await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").click();
  await until(() => fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-alpha"));
  await page.setViewportSize({ width: 390, height: 844 });
  await row("Fixture Beta").getByTitle("Skip — hide from the inbox").click();
  await until(() => fs.readFileSync(pipeline, "utf8").includes("[x] https://example.com/fixture-beta"));
  await page.getByText("Your inbox is empty.", { exact: true }).waitFor();
  assert.equal(await undo().isVisible(), true);
  assert.equal(await undo().evaluate((el) => el.getBoundingClientRect().height >= 44), true);
  await undo().click();
  await row("Fixture Beta").getByTitle("Skip — hide from the inbox").waitFor();

  async function resetInbox() {
    for (const company of ["alpha", "beta"]) {
      const response = await page.request.post(`${origin.origin}/api/inbox/skip`, { data: { url: `https://example.com/fixture-${company}`, done: false } });
      assert.equal(response.ok(), true);
    }
    await page.evaluate(() => localStorage.removeItem("career-ops:hidden"));
    await page.reload();
    await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").waitFor();
  }

  await t.test("Undo waits for a failed Skip and restores the row without a stale error", async () => {
    await resetInbox();
    await page.setViewportSize({ width: 1280, height: 900 });
    let releaseSkip;
    let releaseUndo;
    const skipGate = new Promise((resolve) => { releaseSkip = resolve; });
    const undoGate = new Promise((resolve) => { releaseUndo = resolve; });
    release = () => { releaseSkip(); releaseUndo(); };
    let undoRequests = 0;
    await page.route("**/api/inbox/skip", async (route) => {
      if (route.request().postDataJSON().done) {
        await skipGate;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture skip busy" }) });
      }
      undoRequests++;
      await undoGate;
      await route.continue();
    });
    try {
      await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").click();
      await undo().click();
      releaseSkip();
      await until(() => undoRequests === 1);
      // Failure-handler completion is asserted deterministically in the unit
      // suite. This browser check covers request order and the restored UI.
      releaseUndo();
      await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").waitFor();
      assert.equal(await writeAlerts().count(), 0);
      assert.equal(await undo().count(), 0);
      assert.equal(undoRequests, 1);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  await t.test("Restore ignores repeated clicks and allows retry after a partial failure", async () => {
    await resetInbox();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem("career-ops:hidden", JSON.stringify([
      "https://example.com/fixture-alpha", "https://example.com/fixture-beta",
    ])));
    await page.reload();
    const restore = page.getByRole("button", { name: "2 hidden · restore", exact: true });
    await restore.waitFor();
    const restoreGate = new Promise((resolve) => { release = resolve; });
    let requests = 0;
    await page.route("**/api/inbox/skip", async (route) => {
      requests++;
      await restoreGate;
      if (route.request().postDataJSON().url.endsWith("fixture-beta")) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture restore busy" }) });
      }
      await route.continue();
    });
    try {
      await restore.evaluate((button) => { button.click(); button.click(); button.click(); });
      const restoring = page.getByRole("button", { name: /hidden · restoring/ });
      await restoring.waitFor();
      assert.equal(await restoring.isDisabled(), true);
      assert.equal(await restoring.getAttribute("aria-busy"), "true");
      await until(() => requests === 2);
      release();
      const remaining = page.getByRole("button", { name: "1 hidden · restore", exact: true });
      await remaining.waitFor();
      assert.equal(await remaining.isEnabled(), true);
      assert.equal(requests, 2);
      await page.getByRole("alert").filter({ hasText: "Some jobs could not be restored" }).waitFor();
      await row("Fixture Alpha").getByTitle("Skip — hide from the inbox").waitFor();
      assert.equal(await row("Fixture Beta").count(), 0);
      await page.unrouteAll({ behavior: "wait" });
      await remaining.click();
      await row("Fixture Beta").getByTitle("Skip — hide from the inbox").waitFor();
      assert.equal(await writeAlerts().count(), 0);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
  assert.deepEqual(errors, []);
});
