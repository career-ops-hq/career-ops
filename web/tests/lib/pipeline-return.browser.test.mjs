// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/pipeline-status.mjs as CAREER_OPS_ROOT for a local server.
// Set PIPELINE_RETURN_TEST_URL and PIPELINE_RETURN_TEST_ROOT to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.PIPELINE_RETURN_TEST_URL;
const root = process.env.PIPELINE_RETURN_TEST_ROOT;

test("Pipeline detail links preserve the list context", { skip: liveServerSkip("PIPELINE_RETURN_TEST_URL", "PIPELINE_RETURN_TEST_ROOT"), timeout: 120_000 }, async (t) => {
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
  const query = "tab=EVALUATED&min=3.5&sort=company&dir=1&q=Fixture";
  const back = () => page.getByRole("link", { name: "Pipeline", exact: true }).filter({ has: page.locator("svg.lucide-arrow-left") });

  await page.goto(`${origin.origin}/pipeline?tab=EVALUATED&min=3.5&sort=company&dir=1`);
  const search = page.getByPlaceholder("Search company or role…");
  await search.fill("Fixture"); // local typing does not update the URL
  const row = page.locator("tbody tr").filter({ has: page.getByRole("link", { name: "#11", exact: true }) });
  for (const name of ["#11", "Fixture Alpha", "Engineer"]) {
    const href = await row.getByRole("link", { name, exact: true }).getAttribute("href");
    assert.equal(href, `/pipeline/11?${query}`);
  }
  await row.getByRole("link", { name: "Engineer", exact: true }).click();
  await back().waitFor();
  assert.equal(await back().getAttribute("href"), `/pipeline?${query}`);
  await page.reload(); // the return context survives reloads and copied links
  await back().click();
  await search.waitFor();
  assert.equal(new URL(page.url()).search.slice(1), query);
  assert.equal(await search.inputValue(), "Fixture");
  assert.equal(await page.locator("tbody tr").count(), 2);
  assert.equal(await page.getByRole("columnheader", { name: "company" }).getAttribute("aria-sort"), "ascending");

  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill(""); // clearing a URL-seeded query must also survive return
  await row.getByRole("link", { name: "#11", exact: true }).click();
  await back().waitFor();
  assert.equal(new URL(await back().getAttribute("href"), origin).searchParams.has("q"), false);
  await back().click();
  await search.waitFor();
  assert.equal(await search.inputValue(), "");

  await page.goto(`${origin.origin}/pipeline/11`);
  await back().waitFor();
  assert.equal(await back().getAttribute("href"), "/pipeline");
  assert.deepEqual(errors, []);
});
