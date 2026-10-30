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

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=1`);
  await page.getByRole("link", { name: "#1", exact: true }).waitFor();
  const mounted = () => page.locator("[data-application-key]").count();
  const firstPaint = await mounted();
  assert.ok(firstPaint < 40, `first paint mounted ${firstPaint} rows`);
  assert.ok(firstPaint > 5, `first paint mounted ${firstPaint} rows`);
  await page.getByText("120 tracked").waitFor();
  const heights = await page.locator("[data-application-key]").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  assert.ok(heights.every((h) => Math.abs(h - heights[1]) < 1), `mounted rows differ in height: ${heights.join(", ")}`);
  const bodyHeight = await page.locator("tbody", { has: page.locator("[data-application-key]") }).evaluate((body) => body.getBoundingClientRect().height);
  assert.ok(Math.abs(bodyHeight - 120 * heights[1]) < heights[1], `table body is ${bodyHeight}px for 120 rows of ${heights[1]}px`);
  assert.equal(await page.locator("table[aria-rowcount]").getAttribute("aria-rowcount"), "121");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("link", { name: "#120", exact: true }).waitFor();
  const scrolled = await mounted();
  assert.ok(scrolled < 40, `scrolled paint mounted ${scrolled} rows`);
  assert.equal(await page.getByRole("link", { name: "#1", exact: true }).count(), 0);
  assert.equal(await page.locator("tr", { has: page.getByRole("link", { name: "#120", exact: true }) }).getAttribute("aria-rowindex"), "121");
  await page.getByPlaceholder("Search company or role…").fill("Zulu");
  await page.getByRole("link", { name: "Fixture Zulu", exact: true }).waitFor();
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
  await page.addStyleTag({ content: "html, body { overflow-anchor: none; }" });
  const row = (n) => page.locator("tr[data-application-key]").filter({ has: page.getByRole("link", { name: `#${n}`, exact: true }) });
  await row(1).getByRole("button", { name: /^Edit status/ }).click();
  await row(1).getByRole("combobox").selectOption("Applied");
  await row(1).getByText("saving…").waitFor();

  // Leave the bottom edge. A banner there can grow the page without moving
  // the rows that are already pinned in view. Sit a few pixels past a row
  // boundary around the middle, so the one-line notice changes the window.
  await page.evaluate(() => {
    const rowHeight = document.querySelector("tr[data-application-key]").getBoundingClientRect().height;
    window.scrollTo(0, rowHeight * 50);
    const body = document.querySelector("tbody [data-application-key]").closest("tbody");
    const startPx = Math.max(0, -body.getBoundingClientRect().top);
    const frac = startPx % rowHeight;
    if (frac > 4) window.scrollBy(0, -(frac - 4));
  });
  await page.waitForFunction(() => ![...document.querySelectorAll("a")].some((a) => a.textContent.trim() === "#1"));
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

async function mountedIndexes(page) {
  return page.evaluate(() => {
    const body = document.querySelector("tbody [data-application-key]")?.closest("tbody");
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
