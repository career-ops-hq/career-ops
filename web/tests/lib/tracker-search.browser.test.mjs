// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/pipeline-status.mjs as CAREER_OPS_ROOT for a local server.
// Set TRACKER_SEARCH_TEST_URL and TRACKER_SEARCH_TEST_ROOT to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.TRACKER_SEARCH_TEST_URL;
const root = process.env.TRACKER_SEARCH_TEST_ROOT;

test("Tracker search explains what it filtered and how to undo it", { skip: liveServerSkip("TRACKER_SEARCH_TEST_URL", "TRACKER_SEARCH_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const search = page.getByRole("searchbox", { name: "Search applications" });
  const company = (name) => page.getByRole("link", { name, exact: true });
  const allRowsShown = () => Promise.all(["Fixture Alpha", "Fixture Beta", "Fixture Gamma"].map((name) => company(name).waitFor()));
  const tabPressed = (name) => page.getByRole("button", { name: new RegExp(`^${name} \\d+$`), pressed: true });

  await t.test("a search that matches only under All offers to show it there", async () => {
    await page.goto(`${origin.origin}/pipeline?tab=EVALUATED`);
    await search.fill("Beta");
    await page.getByRole("heading", { name: "No matches for “Beta” in Evaluated" }).waitFor();
    await page.getByRole("button", { name: "Show 1 in All", exact: true }).click();
    await tabPressed("ALL").waitFor();
    await company("Fixture Beta").waitFor();
    assert.equal(await company("Fixture Alpha").count(), 0);
    assert.equal(await search.inputValue(), "Beta");
  });

  await t.test("Escape in the search clears it and every row returns", async () => {
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    await allRowsShown();
  });

  await t.test("a filtered list says how many rows it shows, and the clear button resets it", async () => {
    await search.fill("Alpha");
    await page.getByRole("status").filter({ hasText: "1 of 3 shown" }).waitFor();
    await company("Fixture Gamma").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Clear search" }).click();
    assert.equal(await search.inputValue(), "");
    await allRowsShown();
    assert.equal(await page.getByText(/\d+ of \d+ shown/).count(), 0);
  });

  await t.test("an empty status tab with no search does not mention search", async () => {
    await page.goto(`${origin.origin}/pipeline?tab=OFFER`);
    await page.getByRole("heading", { name: "No Offer applications yet" }).waitFor();
    assert.equal(await page.getByText(/search/i).count(), 0);
  });

  await t.test("a score filter that empties the list names it and clears it", async () => {
    await page.goto(`${origin.origin}/pipeline?tab=ALL&min=4.9`);
    await page.getByRole("heading", { name: "No applications score 4.9 or higher" }).waitFor();
    await page.getByRole("button", { name: "Clear score filter", exact: true }).click();
    await page.waitForURL((u) => !u.searchParams.has("min"));
    await allRowsShown();
  });

  assert.deepEqual(errors, []);
});
