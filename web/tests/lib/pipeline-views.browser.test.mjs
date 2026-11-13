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

test("a narrow window keeps the selected pipeline tab in the strip", { skip: liveServerSkip("PIPELINE_VIEWS_TEST_URL", "PIPELINE_VIEWS_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  function place(label) {
    return page.evaluate((name) => {
      const button = [...document.querySelectorAll("button")].find((el) => {
        const text = (el.textContent || "").trim();
        return text === name || text.startsWith(`${name} `);
      });
      const strip = button?.parentElement;
      if (!button || !strip) return null;
      const tab = button.getBoundingClientRect();
      const box = strip.getBoundingClientRect();
      return {
        inside: tab.left >= box.left - 1 && tab.right <= box.right + 1,
        scrollLeft: strip.scrollLeft,
        scrollY: window.scrollY,
      };
    }, label);
  }

  async function untilInside(label) {
    const started = Date.now();
    let found = null;
    while (!(found && found.inside)) {
      if (Date.now() - started > 15_000) assert.fail(`${label} was not in the strip: ${JSON.stringify(found)}`);
      found = await place(label);
      await page.waitForTimeout(50);
    }
    return found;
  }

  await page.goto(`${origin.origin}/pipeline?tab=SKIP`);
  const wide = await untilInside("SKIP");
  await page.setViewportSize({ width: 320, height: 700 });
  const narrow = await untilInside("SKIP");
  assert.ok(narrow.scrollLeft > wide.scrollLeft);
  assert.ok(Math.abs(narrow.scrollY - wide.scrollY) < 5);

  // locator.click() scrolls the button into view first, so a broken tab
  // effect would still look fine. A DOM click leaves the strip where it is.
  await page.getByRole("button", { name: /^INBOX\b/ }).evaluate((button) => button.click());
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((el) => {
      const text = (el.textContent || "").trim();
      return text === "INBOX" || text.startsWith("INBOX ");
    });
    return button?.getAttribute("aria-pressed") === "true";
  });
  const inbox = await untilInside("INBOX");
  assert.ok(Math.abs(inbox.scrollY - wide.scrollY) < 5);
  assert.deepEqual(errors, []);
});
