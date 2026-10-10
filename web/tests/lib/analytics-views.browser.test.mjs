// Optional live regression: use the disposable pipeline-status fixture and a
// localhost server, then set ANALYTICS_TEST_URL and ANALYTICS_TEST_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const url = process.env.ANALYTICS_TEST_URL;
const root = process.env.ANALYTICS_TEST_ROOT;

test("Analytics rebase retains Progress, Search stats and core Insights", {
  skip: !url || !root,
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const tracker = path.join(root, "data/applications.md");
  const initial = fs.readFileSync(tracker, "utf8");
  for (const name of ["Fixture Alpha", "Fixture Beta", "Fixture Gamma"]) assert.ok(initial.includes(name));

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const nav = page.getByRole("navigation", { name: "Analytics views" });
  for (const query of ["", "?tab=progress", "?view=progress", "?view=bogus"]) {
    await t.test(`Progress and core conversion survive ${query || "the default URL"}`, async () => {
      const response = await page.goto(`${origin.origin}/analytics${query}`);
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { name: "Pipeline progress", exact: true }).waitFor();
      await page.getByRole("heading", { name: "Conversion", exact: true }).waitFor();
      assert.equal(await nav.getByRole("link", { name: "Search progress", exact: true }).getAttribute("aria-current"), "page");
    });
  }
  await t.test("Search stats still renders and links to core Insights", async () => {
    const response = await page.goto(`${origin.origin}/analytics?tab=search-stats`);
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: "Strategic insights", exact: true }).waitFor();
    assert.equal(await nav.getByRole("link", { name: "Search stats", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await nav.getByRole("link", { name: "Insights", exact: true }).getAttribute("href"), "/analytics?view=insights");
  });
  await t.test("Insights keeps the core's small-sample message, without Progress requests", async () => {
    const coreRequests = [];
    const track = (request) => {
      const pathname = new URL(request.url()).pathname;
      if (["/api/stats", "/api/patterns"].includes(pathname)) coreRequests.push(pathname);
    };
    page.on("request", track);
    const response = await page.goto(`${origin.origin}/analytics?view=insights`);
    assert.equal(response.status(), 200);
    await page.getByText("Not enough applications yet", { exact: true }).waitFor();
    assert.equal(await nav.getByRole("link", { name: "Insights", exact: true }).getAttribute("aria-current"), "page");
    assert.ok(coreRequests.includes("/api/patterns"));
    assert.ok(!coreRequests.includes("/api/stats"));
    assert.equal(await page.getByRole("heading", { name: "Pipeline progress", exact: true }).count(), 0);
    page.off("request", track);
  });
  assert.deepEqual(errors, []);
  assert.equal(fs.readFileSync(tracker, "utf8"), initial);
});
