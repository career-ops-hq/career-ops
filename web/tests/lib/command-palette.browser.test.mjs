// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/pipeline-status.mjs as CAREER_OPS_ROOT for a local server.
// Set COMMAND_PALETTE_TEST_URL and COMMAND_PALETTE_TEST_ROOT to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.COMMAND_PALETTE_TEST_URL;
const root = process.env.COMMAND_PALETTE_TEST_ROOT;

test("Ctrl+K jumps to a page or an application from anywhere", { skip: liveServerSkip("COMMAND_PALETTE_TEST_URL", "COMMAND_PALETTE_TEST_ROOT"), timeout: 120_000 }, async (t) => {
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
  const combobox = page.getByRole("combobox", { name: "Jump to a page or application" });
  const trigger = page.getByRole("button", { name: "Search", exact: true });
  const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement);

  await page.goto(`${origin.origin}/analytics`);
  await trigger.filter({ hasText: /Ctrl K|⌘K/ }).waitFor();

  await page.keyboard.press("Control+k");
  await combobox.waitFor();
  assert.ok(await isFocused(combobox), "Ctrl+K focuses the palette input");
  await page.keyboard.type("alpha");
  const first = page.getByRole("option").first();
  await first.filter({ hasText: "Fixture Alpha" }).waitFor();
  assert.equal(await first.getAttribute("aria-selected"), "true");
  assert.equal(await combobox.getAttribute("aria-activedescendant"), await first.getAttribute("id"));
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin.origin}/pipeline/11`);
  await page.getByRole("heading", { level: 1, name: "Fixture Alpha", exact: true }).waitFor();
  await combobox.waitFor({ state: "hidden" });

  await page.keyboard.press("Control+k");
  await combobox.waitFor();
  assert.equal(await combobox.inputValue(), "", "the query resets on open");
  await page.keyboard.type("config");
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin.origin}/config`);

  await trigger.focus();
  await page.keyboard.press("Control+k");
  await combobox.waitFor();
  await page.keyboard.press("Escape");
  await combobox.waitFor({ state: "hidden" });
  assert.ok(await isFocused(trigger), "Escape returns focus to the element focused before opening");

  await trigger.click();
  await combobox.waitFor();
  assert.ok(await isFocused(combobox), "the sidebar button opens the palette");
  await page.keyboard.press("Escape");
  await combobox.waitFor({ state: "hidden" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Control+k");
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  const box = await combobox.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "Ctrl+K opens a visible palette below md");
  assert.equal(await dialog.evaluate((el) => el.closest("aside") == null), true, "the dialog is not inside the hidden sidebar");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { level: 1 }).waitFor();

  assert.deepEqual(errors, []);
});
