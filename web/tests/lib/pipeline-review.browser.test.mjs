// Run with node tests/browser-suites.mjs pipeline-review (fictional pipeline-long data).
import assert from "node:assert/strict";
import test from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

test("report review follows the filtered tracker window and survives slow and failed loads", {
  skip: liveServerSkip("PIPELINE_REVIEW_TEST_URL"),
  timeout: 60_000,
}, async (t) => {
  const origin = new URL(process.env.PIPELINE_REVIEW_TEST_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  const requests = [];
  const slow = Promise.withResolvers();
  const release = Promise.withResolvers();
  const slowFinished = Promise.withResolvers();
  let failOnce = true;
  t.after(async () => {
    release.resolve();
    await browser.close();
  });
  await page.route("**/api/pipeline/report?*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    requests.push(id);
    if (id === "42") {
      const response = await route.fetch();
      slow.resolve();
      await release.promise;
      // The browser can abort this request when Next is clicked.
      await route.fulfill({ response }).catch(() => {});
      slowFinished.resolve();
    } else if (id === "30" && failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, body: "Fixture report unavailable" });
    } else {
      await route.continue();
    }
  });

  const url = `${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=-1&min=4`;
  await page.goto(url);
  const panel = page.getByRole("complementary", { name: "Report review" });
  const company = (n) => page.getByRole("link", { name: `Fixture Company ${n}`, exact: true });
  const report = (n) => panel.getByText(`Fictional browser test report for Fixture Company ${n}.`, { exact: true });
  const search = page.getByRole("searchbox", { name: "Search applications" });
  const scrollY = () => page.evaluate(() => window.scrollY);

  await page.getByRole("button", { name: "Review reports", exact: true }).click();
  await panel.getByText("Choose an application from the list.").waitFor();
  assert.deepEqual(requests, []);
  await page.locator("tbody tr[data-application-key]").first().evaluate((row) => {
    const top = row.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + 14 * row.getBoundingClientRect().height);
  });
  await company(42).click();
  const top = await scrollY();
  assert.ok(top > 400, "the queue was scrolled before switching reports");
  const tableBox = await page.getByRole("table", { name: "Tracked applications" }).locator("..").boundingBox();
  const panelBox = await panel.boundingBox();
  assert.ok(panelBox.x >= tableBox.x + tableBox.width, "the report is beside the list");
  await slow.promise;

  // In descending tracker order with score >= 4, #42 is followed by #31.
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await report(31).waitFor();
  release.resolve();
  await slowFinished.promise;
  assert.equal(await report(42).count(), 0);
  assert.equal(await scrollY(), top);
  assert.equal(page.url(), url);

  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Could not load this report." }).waitFor();
  assert.equal(await report(31).count(), 0);
  assert.equal(await scrollY(), top);
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await report(30).waitFor();
  await panel.getByRole("button", { name: "Previous", exact: true }).click();
  await report(31).waitFor();
  assert.equal(await scrollY(), top);
  assert.deepEqual(requests, ["42", "31", "30", "30", "31"]);
  assert.match(await panel.getByRole("link", { name: "Open full report" }).getAttribute("href"), /^\/pipeline\/31\?/);

  await search.fill("Fixture Company 79");
  await panel.getByText("Choose an application from the list.").waitFor();
  assert.equal(await report(31).count(), 0);
  await search.fill("No such fixture application");
  await panel.getByText("No applications match this view.").waitFor();
  await search.fill("Fixture Company 79");
  await company(79).click();
  await report(79).waitFor();
  assert.ok(await panel.getByRole("button", { name: "Previous", exact: true }).isDisabled());
  assert.ok(await panel.getByRole("button", { name: "Next", exact: true }).isDisabled());

  await page.setViewportSize({ width: 750, height: 800 });
  await panel.waitFor({ state: "hidden" });
  await company(79).click();
  await page.waitForURL("**/pipeline/79?*");
  await page.getByRole("heading", { name: "Fixture Company 79", exact: true }).waitFor();
});
