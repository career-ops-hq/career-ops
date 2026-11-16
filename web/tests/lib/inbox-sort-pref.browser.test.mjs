// Live-browser regression for the pipeline's default sort. Disposable,
// fictional data only: tests/browser-suites.mjs builds the inbox-undo fixture,
// starts the server and sets INBOX_SORT_PREF_TEST_URL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.INBOX_SORT_PREF_TEST_URL;
const KEY = "career-ops:inbox-sort";

test("Make default saves the sort; picking a sort alone does not; bad values fall back to Best fit", {
  skip: liveServerSkip("INBOX_SORT_PREF_TEST_URL"), timeout: 90_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("career-ops:first-score-seen", "1");
  });

  const sort = page.getByRole("group", { name: "Sort inbox" });
  const fit = sort.getByRole("button", { name: "Best fit" });
  const newest = sort.getByRole("button", { name: "Newest" });
  const makeDefault = sort.getByRole("button", { name: "Make default" });
  const isDefault = sort.getByRole("button", { name: "✓ Default" });
  const pressed = (button) => button.getAttribute("aria-pressed");
  const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  async function until(check) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 15_000) assert.fail("UI did not reach expected state");
      await page.waitForTimeout(50);
    }
  }
  const reload = async () => { await page.reload(); await fit.waitFor(); };

  // First visit: nothing stored, Best fit, and it already reads as the default.
  await page.goto(`${origin.origin}/pipeline`);
  await fit.waitFor();
  assert.equal(await pressed(fit), "true");
  await until(async () => (await isDefault.count()) === 1);
  assert.equal(await makeDefault.count(), 0);
  assert.equal(await isDefault.isDisabled(), true);
  assert.equal(await stored(), null);

  // Picking Newest changes the view only: the pill offers "Make default", nothing is stored,
  // and a reload goes back to Best fit.
  await newest.click();
  assert.equal(await pressed(newest), "true");
  await makeDefault.waitFor();
  assert.equal(await stored(), null);
  await reload();
  assert.equal(await pressed(fit), "true");
  assert.equal(await stored(), null);

  // Make default on Newest: stored, the pill turns into a check mark, and a reload opens on Newest.
  await newest.click();
  await makeDefault.click();
  await until(async () => (await isDefault.count()) === 1);
  assert.equal(await stored(), "newest");
  await reload();
  await until(async () => (await pressed(newest)) === "true");
  assert.equal(await pressed(fit), "false");
  await until(async () => (await isDefault.count()) === 1);

  // Looking at Best fit now offers to make that the default instead; unsaved, reload returns to Newest.
  await fit.click();
  await makeDefault.waitFor();
  assert.equal(await stored(), "newest");
  await reload();
  await until(async () => (await pressed(newest)) === "true");

  // Make Best fit the default again.
  await fit.click();
  await makeDefault.click();
  await until(async () => (await isDefault.count()) === 1);
  assert.equal(await stored(), "fit");
  await reload();
  assert.equal(await pressed(fit), "true");

  // A stale or hand-edited value reads as Best fit.
  await page.evaluate((k) => localStorage.setItem(k, "oldest"), KEY);
  await reload();
  assert.equal(await pressed(fit), "true");
  await until(async () => (await isDefault.count()) === 1);

  // Two tabs: saving a default in one updates the other tab's pill, but not its view.
  const tabB = await context.newPage();
  await tabB.goto(`${origin.origin}/pipeline`);
  const sortB = tabB.getByRole("group", { name: "Sort inbox" });
  await sortB.getByRole("button", { name: "✓ Default" }).waitFor(); // Best fit is the default here
  await newest.click();
  await makeDefault.click();
  await until(async () => (await stored()) === "newest");
  // Tab B still views Best fit, now offers to make it the default again.
  await sortB.getByRole("button", { name: "Make default" }).waitFor();
  assert.equal(await sortB.getByRole("button", { name: "Best fit" }).getAttribute("aria-pressed"), "true");
  await tabB.close();
  await page.evaluate((k) => localStorage.setItem(k, "fit"), KEY);

  // Storage refusing writes for this key (private mode, quota): the page works, the view still
  // changes, and Make default says it could not save instead of pretending it did.
  const blocked = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const blockedErrors = [];
  blocked.on("pageerror", (error) => blockedErrors.push(error.message));
  await blocked.addInitScript((key) => {
    localStorage.setItem("career-ops:first-score-seen", "1");
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) { if (k === key) throw new DOMException("denied", "SecurityError"); return get.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException("quota", "QuotaExceededError"); return set.call(this, k, v); };
  }, KEY);
  await blocked.goto(`${origin.origin}/pipeline`);
  const blockedSort = blocked.getByRole("group", { name: "Sort inbox" });
  await blockedSort.getByRole("button", { name: "Best fit" }).waitFor();
  assert.equal(await blockedSort.getByRole("button", { name: "Best fit" }).getAttribute("aria-pressed"), "true");
  await blockedSort.getByRole("button", { name: "Newest" }).click();
  assert.equal(await blockedSort.getByRole("button", { name: "Newest" }).getAttribute("aria-pressed"), "true");
  await blockedSort.getByRole("button", { name: "Make default" }).click();
  await blockedSort.getByText("Can’t save in this browser").waitFor();
  assert.equal(await blockedSort.getByRole("button", { name: "Make default" }).count(), 1, "still offered, not a silent no-op");
  assert.deepEqual(blockedErrors, []);

  assert.deepEqual(errors, []);
});
