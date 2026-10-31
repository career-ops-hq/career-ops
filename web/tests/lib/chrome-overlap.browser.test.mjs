// Desktop chrome must stay in the sidebar column. At 1440x900 the version
// pill and the Ask button used to sit on the main column: the pill crossed
// out of the 240px sidebar, and Ask covered the bottom-right of the page.
// On short desktop windows the sidebar has no free space at its foot, so Ask
// must stay off its links and controls there.
// Set CHROME_OVERLAP_TEST_URL to a local server. npm test skips this.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CHROME_OVERLAP_TEST_URL;

function overlapSize(a, b) {
  if (!a || !b) return null;
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return null;
  return { w: Math.round(w), h: Math.round(h) };
}

test("version pill and Ask stay out of the main column at 1440x900", {
  skip: liveServerSkip("CHROME_OVERLAP_TEST_URL"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin.origin}/`, { waitUntil: "domcontentloaded" });
  const ask = page.getByRole("button", { name: "Ask the assistant", exact: true });
  const report = page.getByRole("button", { name: "Report a bug" });
  await ask.waitFor();
  await report.waitFor();

  const main = await page.locator("main").boundingBox();
  const askBox = await ask.boundingBox();
  const pillBox = await report.locator("xpath=..").boundingBox();
  const theme = await page.getByRole("complementary").filter({ has: page.getByRole("navigation") }).getByRole("button", { name: "Dark mode" }).boundingBox();
  assert.ok(main && askBox && pillBox && theme);

  assert.equal(overlapSize(pillBox, main), null, "version pill intersects main");
  assert.equal(overlapSize(askBox, main), null, "Ask button intersects main");
  assert.equal(overlapSize(askBox, pillBox), null, "Ask button intersects the version pill");
  assert.equal(overlapSize(askBox, theme), null, "Ask button covers Dark mode");
  assert.equal(overlapSize(pillBox, theme), null, "version pill covers Dark mode");

  const hits = await page.evaluate(() => {
    const labelAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const control = el?.closest("button, a");
      return control?.getAttribute("aria-label") || control?.textContent?.trim() || "";
    };
    return {
      left: labelAt(300, 870),
      right: labelAt(1400, 860),
    };
  });
  assert.equal(hits.left.includes("Report a bug"), false, `bottom of the main column hit ${hits.left}`);
  assert.equal(hits.right.includes("Ask the assistant"), false, `bottom-right of the viewport hit ${hits.right}`);
  assert.deepEqual(errors, []);
});

test("Ask stays off the sidebar's links and controls at short and tall desktop heights", {
  skip: liveServerSkip("CHROME_OVERLAP_TEST_URL"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  for (const height of [480, 560, 720, 900]) {
    const page = await browser.newPage({ viewport: { width: 1280, height } });
    await page.goto(`${origin.origin}/`, { waitUntil: "domcontentloaded" });
    const ask = page.getByRole("button", { name: "Ask the assistant", exact: true });
    const sidebar = page.getByRole("complementary").filter({ has: page.getByRole("navigation") });
    await ask.waitFor();
    await sidebar.getByRole("button", { name: "Dark mode" }).waitFor();

    const askBox = await ask.boundingBox();
    assert.ok(askBox);
    const controls = await sidebar.locator("a, button").all();
    assert.ok(controls.length >= 5, `only ${controls.length} sidebar controls found`);
    for (const control of controls) {
      const box = await control.boundingBox();
      const name = (await control.getAttribute("aria-label")) || (await control.innerText()).trim();
      assert.equal(overlapSize(askBox, box), null, `Ask covers sidebar control "${name}" at 1280x${height}`);
    }
    await page.close();
  }
});
