// Optional Chrome regression: start the local web server against disposable
// data containing a fictional cv.md, then
// CV_PREVIEW_LINES_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
// The editor is only filled, never saved, so the data root is not written.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CV_PREVIEW_LINES_TEST_URL;
const markdown = "# CV -- Sample Candidate\n\n**Location:** Portland, OR\n**Phone:** on request\n\n- First bullet\n- Second bullet\n";

test("CV preview keeps one header field per line without blank lines between blocks", { skip: liveServerSkip("CV_PREVIEW_LINES_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/cv`);
  await page.locator("textarea").first().fill(markdown);
  const preview = page.locator("article.report-prose");
  await preview.getByText("on request").waitFor();

  const box = async (locator) => (await locator.boundingBox()) ?? assert.fail("element is laid out");
  const location = await box(preview.locator("strong", { hasText: "Location:" }));
  const email = await box(preview.locator("strong", { hasText: "Phone:" }));
  const lineHeight = await preview.locator("p", { hasText: "Location:" }).evaluate((p) => parseFloat(getComputedStyle(p).lineHeight));
  assert.ok(email.y - location.y >= lineHeight / 2, `Phone starts on a line below Location (Location top ${location.y}, Phone top ${email.y}, line height ${lineHeight})`);

  const items = preview.locator("li");
  const first = await box(items.nth(0));
  const second = await box(items.nth(1));
  const gap = second.y - (first.y + first.height);
  assert.ok(gap < lineHeight, `no blank line between list items (gap ${gap}, line height ${lineHeight})`);
  assert.deepEqual(errors, []);
});
