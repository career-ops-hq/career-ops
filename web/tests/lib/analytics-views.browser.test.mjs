// Optional live regression: use the disposable pipeline-status fixture and a
// localhost server, then set ANALYTICS_TEST_URL and ANALYTICS_TEST_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.ANALYTICS_TEST_URL;
const root = process.env.ANALYTICS_TEST_ROOT;

test("Analytics rebase retains Progress, Search stats and core Insights", {
  skip: liveServerSkip("ANALYTICS_TEST_URL", "ANALYTICS_TEST_ROOT"),
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
  for (const query of ["", "?view=progress", "?view=bogus", "?tab=search-stats", "?view=progress&tab=search-stats"]) {
    await t.test(`Progress and core conversion survive ${query || "the default URL"}`, async () => {
      const response = await page.goto(`${origin.origin}/analytics${query}`);
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { name: "Pipeline progress", exact: true }).waitFor();
      await page.getByRole("heading", { name: "Conversion", exact: true }).waitFor();
      assert.equal(await nav.getByRole("link", { name: "Search progress", exact: true }).getAttribute("aria-current"), "page");
      assert.deepEqual(await nav.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href"))),
        ["/analytics", "/analytics?view=insights", "/analytics?view=search-stats"]);
    });
  }
  await t.test("Search stats still renders and links to core Insights", async () => {
    const response = await page.goto(`${origin.origin}/analytics?view=search-stats&tab=progress`);
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: "Strategic insights", exact: true }).waitFor();
    assert.equal(await nav.getByRole("link", { name: "Search stats", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await nav.getByRole("link", { name: "Insights", exact: true }).getAttribute("href"), "/analytics?view=insights");
    assert.equal(await page.getByRole("heading", { name: "Pipeline progress", exact: true }).count(), 0);
  });
  await t.test("Insights keeps the core's small-sample message, without Progress requests", async () => {
    const coreRequests = [];
    const track = (request) => {
      const pathname = new URL(request.url()).pathname;
      if (["/api/stats", "/api/patterns"].includes(pathname)) coreRequests.push(pathname);
    };
    page.on("request", track);
    const response = await page.goto(`${origin.origin}/analytics?view=insights&tab=search-stats`);
    assert.equal(response.status(), 200);
    await page.getByText("Not enough applications yet", { exact: true }).waitFor();
    assert.equal(await nav.getByRole("link", { name: "Insights", exact: true }).getAttribute("aria-current"), "page");
    assert.ok(coreRequests.includes("/api/patterns"));
    assert.ok(!coreRequests.includes("/api/stats"));
    assert.equal(await page.getByRole("heading", { name: "Pipeline progress", exact: true }).count(), 0);
    page.off("request", track);
  });
  await t.test("view links navigate between all three panels using one query contract", async () => {
    await nav.getByRole("link", { name: "Search stats", exact: true }).click();
    await page.getByRole("heading", { name: "Strategic insights", exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, "?view=search-stats");
    await nav.getByRole("link", { name: "Search progress", exact: true }).click();
    await page.getByRole("heading", { name: "Pipeline progress", exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, "");
    await nav.getByRole("link", { name: "Insights", exact: true }).click();
    await page.getByText("Not enough applications yet", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, "?view=insights");
  });
  assert.deepEqual(errors, []);
  assert.equal(fs.readFileSync(tracker, "utf8"), initial);
});
