// Optional Chrome regression: start the local web server against the
// pipeline-status fixture (its Applied row gives /followups an entry), then
// DIALOG_FOCUS_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
// Every mutating API is intercepted; no CLI or real data write is invoked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.DIALOG_FOCUS_TEST_URL;
test("Modal dialogs take focus, trap Tab, close on Escape and return focus", { skip: liveServerSkip("DIALOG_FOCUS_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const unexpected = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/api/**", (route) => {
    if (route.request().method() === "GET") return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  await page.route("**/api/version", (route) => route.fulfill({ json: { version: "web 0.0.0-fixture", coreVersion: "0.0.0", channel: "alpha", sha: "fixture" } }));
  await page.route("https://api.github.com/**", (route) => route.fulfill({ json: { total_count: 0, items: [] } }));

  async function until(check, message) {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(message);
  }
  const focused = (locator) => locator.evaluate((el) => el === document.activeElement);

  async function assertModalKeyboard(path, findOpener, name) {
    await page.goto(`${origin.origin}${path}`);
    const opener = findOpener();
    await opener.waitFor();
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name });
    await dialog.waitFor();
    const holdsFocus = () => dialog.evaluate((el) => el.contains(document.activeElement));
    await until(holdsFocus, "focus moves into the dialog when it opens");
    for (let i = 1; i <= 15; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await holdsFocus(), true, `focus is still inside the dialog after Tab ${i}`);
    }
    for (let i = 1; i <= 5; i++) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await holdsFocus(), true, `focus is still inside the dialog after Shift+Tab ${i}`);
    }
    await page.keyboard.press("Escape");
    await until(async () => (await dialog.count()) === 0, "Escape closes the dialog");
    await until(() => focused(opener), "focus returns to the control that opened the dialog");
  }

  const row = () => page.locator("tbody tr", { hasText: "Fixture Beta" });
  await t.test("Log follow-up", () =>
    assertModalKeyboard("/followups", () => row().getByRole("button", { name: "Log follow-up for Fixture Beta", exact: true }), /Log follow-up.*Fixture Beta/));
  await t.test("Next follow-up date", () =>
    assertModalKeyboard("/followups", () => row().getByRole("button", { name: "Next date for Fixture Beta", exact: true }), /Pin next follow-up.*Fixture Beta/));
  await t.test("Next follow-up date field takes a key and Tab stays in the dialog", async () => {
    await page.goto(`${origin.origin}/followups`);
    const opener = row().getByRole("button", { name: "Next date for Fixture Beta", exact: true });
    await opener.waitFor();
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /Pin next follow-up.*Fixture Beta/ });
    await dialog.waitFor();
    const date = dialog.locator("input[type='date']");
    await until(() => focused(date), "the date field takes focus");
    const before = await date.inputValue();
    await page.keyboard.press("ArrowUp");
    await until(async () => (await date.inputValue()) !== before, "ArrowUp edits the date");
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await until(async () => (await dialog.count()) === 0, "Escape closes the date dialog");
  });
  await t.test("Report a bug", () =>
    assertModalKeyboard("/", () => page.getByRole("button", { name: "Report a bug", exact: true }), /Report a bug/));
  assert.deepEqual(unexpected, []);
});
