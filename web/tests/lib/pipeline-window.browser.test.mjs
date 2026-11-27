// A long tracker must not mount every row. Set PIPELINE_WINDOW_TEST_URL and
// PIPELINE_WINDOW_TEST_ROOT, or run node tests/browser-suites.mjs pipeline-window.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";
import { TRACKER_OVERSCAN, trackerWindow } from "../../src/lib/tracker-window.mjs";

const url = process.env.PIPELINE_WINDOW_TEST_URL;
const root = process.env.PIPELINE_WINDOW_TEST_ROOT;

test("the pipeline table mounts a window of a long tracker", { skip: liveServerSkip("PIPELINE_WINDOW_TEST_URL", "PIPELINE_WINDOW_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".tracker-window-fixture"), "utf8").trim(), "fictional-only");

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Count and match only what is on screen. On a slow runner the page can hold
  // a second, hidden copy of the table for a moment (CI saw 2 matches for the
  // "tracked" count, 2 tables for `table[aria-rowcount]` and 13 rows for a
  // one-row search), so every locator below that could match inside it is
  // scoped to visible elements.
  const visible = (locator) => locator.filter({ visible: true });
  const mounted = () => page.locator("[data-application-key]:visible").count();
  async function untilMounted(n) {
    const start = Date.now();
    while (await mounted() !== n && Date.now() - start < 10_000) await page.waitForTimeout(50);
  }

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=1`);
  await visible(page.getByRole("link", { name: "#1", exact: true })).waitFor();
  const firstPaint = await mounted();
  assert.ok(firstPaint < 40, `first paint mounted ${firstPaint} rows`);
  assert.ok(firstPaint > 5, `first paint mounted ${firstPaint} rows`);
  await visible(page.getByText("120 tracked")).waitFor();
  const heights = await page.locator("[data-application-key]:visible").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  assert.ok(heights.every((h) => Math.abs(h - heights[1]) < 1), `mounted rows differ in height: ${heights.join(", ")}`);
  const bodyHeight = await page.locator("tbody", { has: page.locator("[data-application-key]:visible") }).evaluate((body) => body.getBoundingClientRect().height);
  assert.ok(Math.abs(bodyHeight - 120 * heights[1]) < heights[1], `table body is ${bodyHeight}px for 120 rows of ${heights[1]}px`);
  assert.equal(await visible(page.locator("table[aria-rowcount]")).getAttribute("aria-rowcount"), "121");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await visible(page.getByRole("link", { name: "#120", exact: true })).waitFor();
  const scrolled = await mounted();
  assert.ok(scrolled < 40, `scrolled paint mounted ${scrolled} rows`);
  assert.equal(await visible(page.getByRole("link", { name: "#1", exact: true })).count(), 0);
  assert.equal(await visible(page.locator("tr", { has: page.getByRole("link", { name: "#120", exact: true }) })).getAttribute("aria-rowindex"), "121");
  await visible(page.getByPlaceholder("Search company or role…")).fill("Zulu");
  await visible(page.getByRole("link", { name: "Fixture Zulu", exact: true })).waitFor();
  // Fixture Zulu can already be on screen at the bottom of the list before the
  // search applies, so wait for the filtered count rather than for its row.
  await untilMounted(1);
  assert.equal(await mounted(), 1);
  assert.deepEqual(errors, []);
});

test("an off-screen save failure moves the window, and the error row does not set the spacer", { skip: liveServerSkip("PIPELINE_WINDOW_TEST_URL", "PIPELINE_WINDOW_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".tracker-window-fixture"), "utf8").trim(), "fictional-only");
  const tracker = path.join(root, "data/applications.md");
  const initial = fs.readFileSync(tracker, "utf8");

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const failure = "Fixture tracker busy; retry shortly";
  await page.route("**/api/status", async (route) => {
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: failure }) });
  });

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=1`);
  // Keep the scroll position when the banner is inserted above the table.
  // Anchoring on a row would hold the table still, so the window would not move.
  await page.addStyleTag({ content: "* { overflow-anchor: none !important; }" });
  const row = (n) => page.locator("tr[data-application-key]:visible").filter({ has: page.getByRole("link", { name: `#${n}`, exact: true }) });
  await row(1).getByRole("button", { name: /^Edit status/ }).click();
  await row(1).getByRole("combobox").selectOption("Applied");
  await row(1).getByRole("button", { name: "Yes, mark applied" }).click();
  await row(1).getByText("saving…").waitFor();

  // Leave the bottom edge. A banner there can grow the page without moving
  // the rows that are already pinned in view. Sit a few pixels past a row
  // boundary around the middle, so the one-line notice changes the window.
  // The saving row is taller than the spacers, so measure a normal row.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tr[data-application-key]")]
      .find((el) => el.checkVisibility() && !el.querySelector("[role='alert'], [aria-busy='true']"));
    window.scrollTo(0, row.getBoundingClientRect().height * 50);
  });
  await page.waitForFunction(() => ![...document.querySelectorAll("a")].some((a) => a.checkVisibility() && a.textContent.trim() === "#1"));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tr[data-application-key]")]
      .find((el) => el.checkVisibility() && !el.querySelector("[role='alert'], [aria-busy='true']"));
    const rowHeight = row.getBoundingClientRect().height;
    const startPx = Math.max(0, -row.closest("tbody").getBoundingClientRect().top);
    const frac = startPx % rowHeight;
    const delta = frac > 4 ? -(frac - 4) : -(rowHeight - (4 - frac));
    window.scrollBy(0, delta);
  });
  await page.waitForFunction(() => ![...document.querySelectorAll("a")].some((a) => a.checkVisibility() && a.textContent.trim() === "#1"));
  assert.equal(await page.getByRole("link", { name: "#1", exact: true }).count(), 0);
  const before = await mountedIndexes(page);

  release();
  const banner = page.getByRole("alert").filter({ hasText: "Application #1 was not saved" });
  await banner.waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await banner.evaluate((el) => el.closest("tr[data-application-key]") == null), true);
  const during = await mountedIndexes(page);
  assert.notDeepEqual(during.indexes, before.indexes, "the banner has to move which rows are mounted");
  assertWindow(during, 120);
  assert.equal(await page.getByRole("link", { name: "#1", exact: true }).count(), 0);
  assert.equal(fs.readFileSync(tracker, "utf8"), initial);

  // The Inbox tab mounts no tracker rows, so every held failure counts as off
  // screen there and the banner would sit over the inbox. Wait for the route,
  // not just the pressed tab: while the switch is pending, the rows behind it
  // are still the ALL rows. Back on ALL, row #1 still shows its error below.
  await page.getByRole("button", { name: /^INBOX \d+$/ }).click();
  await page.waitForURL((u) => !u.searchParams.has("tab"));
  await page.evaluate(() => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 300)));
  assert.equal(await page.locator("tr[data-application-key]:visible").count(), 0);
  assert.equal(await page.getByText("Application #1 was not saved").count(), 0);
  await page.getByRole("button", { name: /^ALL \d+$/ }).click();
  await page.waitForURL((u) => u.searchParams.get("tab") === "ALL");

  await page.evaluate(() => window.scrollTo(0, 0));
  await row(1).getByRole("alert").waitFor();
  assert.equal(await page.getByText("Application #1 was not saved").count(), 0);
  assert.match(await row(1).getByRole("alert").innerText(), /Fixture tracker busy/);
  const back = await mountedIndexes(page);
  const errorHeight = await row(1).evaluate((el) => el.getBoundingClientRect().height);
  const spacerHeight = await page.locator("tbody tr[aria-hidden='true'] td").last().evaluate((el) => el.getBoundingClientRect().height);
  const hiddenRows = 120 - back.indexes.length;
  const spacerPerRow = spacerHeight / hiddenRows;
  assert.ok(errorHeight > spacerPerRow + 8, `failed row is ${errorHeight}px and the spacer is ${spacerPerRow}px`);
  assert.ok(Math.abs(spacerPerRow - errorHeight) > 20, `spacer ${spacerPerRow}px adopted the failed row`);
  assert.deepEqual(errors, []);
});

test("j/k and Shift-click reach rows outside the window", { skip: liveServerSkip("PIPELINE_WINDOW_TEST_URL", "PIPELINE_WINDOW_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".tracker-window-fixture"), "utf8").trim(), "fictional-only");
  const tracker = path.join(root, "data/applications.md");
  const initial = fs.readFileSync(tracker, "utf8");

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=1`);
  await page.getByRole("link", { name: "#1", exact: true }).waitFor();
  await page.getByText("120 tracked").filter({ visible: true }).waitFor();
  const link = (n) => page.getByRole("link", { name: `#${n}`, exact: true });
  const row = (n) => page.locator("tr[data-application-key]:visible").filter({ has: link(n) });
  const cursorRow = page.locator('tr[data-tracker-cursor="true"]');
  const inView = (locator) => locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    // A row border can sit half a pixel past the edge.
    return rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
  });

  await page.getByRole("heading", { name: "Pipeline", exact: true }).click();
  await page.keyboard.press("j");
  await cursorRow.filter({ has: link(1) }).waitFor();
  assert.equal(await cursorRow.getAttribute("aria-rowindex"), "2");

  // Leave the cursor on #1 and scroll to the end, so #1 and #2 unmount.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await link(120).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll("a")].some((a) => ["#1", "#2"].includes(a.textContent.trim())));
  assert.equal(await cursorRow.count(), 0, "the cursor row is not mounted");

  await page.keyboard.press("j");
  await cursorRow.filter({ has: link(2) }).waitFor();
  assert.equal(await cursorRow.getAttribute("aria-rowindex"), "3");
  assert.equal(await cursorRow.count(), 1);
  assert.ok(await inView(cursorRow), "j scrolls the next row into view");
  assert.equal(await link(120).count(), 0);

  // The same from the other side: k from a row far below the window.
  for (let i = 0; i < 3; i++) await page.keyboard.press("j");
  await cursorRow.filter({ has: link(5) }).waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => !document.querySelector('[data-tracker-cursor="true"]'));
  await page.keyboard.press("k");
  await cursorRow.filter({ has: link(4) }).waitFor();
  assert.ok(await inView(cursorRow), "k scrolls back to the row above the cursor");

  // Shift-click selects every row in between, mounted or not.
  await page.evaluate(() => window.scrollTo(0, 0));
  await row(3).getByRole("checkbox").click();
  await page.getByText("1 selected", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await link(118).waitFor();
  assert.equal(await link(3).count(), 0, "the anchor row is not mounted");
  await row(118).getByRole("checkbox").click({ modifiers: ["Shift"] });
  await page.getByText("116 selected", { exact: true }).waitFor();
  await page.evaluate(() => {
    const body = [...document.querySelectorAll("tbody [data-application-key]")].find((el) => el.checkVisibility()).closest("tbody");
    window.scrollTo(0, body.getBoundingClientRect().top + window.scrollY + body.getBoundingClientRect().height / 2);
  });
  await link(60).waitFor();
  assert.equal(await row(60).getByRole("checkbox").isChecked(), true, "a row mounted after the Shift-click shows as selected");
  await page.evaluate(() => window.scrollTo(0, 0));
  await link(2).waitFor();
  assert.equal(await row(2).getByRole("checkbox").isChecked(), false);
  assert.equal(await row(3).getByRole("checkbox").isChecked(), true);

  assert.equal(fs.readFileSync(tracker, "utf8"), initial);
  assert.deepEqual(errors, []);
});

async function mountedIndexes(page) {
  return page.evaluate(() => {
    const body = [...document.querySelectorAll("tbody [data-application-key]")].find((el) => el.checkVisibility())?.closest("tbody");
    const rows = [...body.querySelectorAll("tr[data-application-key]")];
    const sample = rows.find((row) => !row.querySelector("[role='alert'], [aria-busy='true']")) || rows[0];
    return {
      tableTop: body.getBoundingClientRect().top,
      rowHeight: sample.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      indexes: rows.map((row) => Number(row.getAttribute("aria-rowindex"))),
    };
  });
}

function assertWindow(snap, count) {
  const span = trackerWindow({
    count,
    rowHeight: snap.rowHeight,
    overscan: TRACKER_OVERSCAN,
    tableTop: snap.tableTop,
    viewportHeight: snap.viewportHeight,
  });
  const expected = Array.from({ length: span.end - span.start }, (_, i) => span.start + i + 2);
  assert.deepEqual(snap.indexes, expected);
}
