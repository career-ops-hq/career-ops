// Opt-in real Chrome regression: start the local web server against the
// fictional pipeline-status fixture (one Applied row, so /followups lists an
// entry), then ACCESSIBLE_NAMES_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
// Every mutating API is intercepted; no CLI or real data write is invoked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.ACCESSIBLE_NAMES_TEST_URL;
test("visible labels are part of accessible names, and shell content sits in landmarks", { skip: liveServerSkip("ACCESSIBLE_NAMES_TEST_URL"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const unexpected = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/api/**", (route) => {
    if (route.request().method() === "GET") return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  const PRERELEASE_VERSION_STUB = { version: "0.0.0-fixture", channel: "alpha", sha: "f1x7ure" };
  await page.route("**/api/version", (route) => route.fulfill({ json: PRERELEASE_VERSION_STUB }));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  async function nameOf(locator) {
    await locator.evaluate((el) => el.setAttribute("data-ax-probe", ""));
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-ax-probe]" });
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
    await locator.evaluate((el) => el.removeAttribute("data-ax-probe"));
    return nodes[0]?.name?.value ?? "";
  }
  const voiceControlLabel = (locator) => locator.evaluate((el) => {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      const box = parent.getBoundingClientRect();
      if (parent.closest("[aria-hidden=true]") || box.width <= 1 || box.height <= 1) continue;
      parts.push(walker.currentNode.textContent);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  });
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

  const launcher = page.locator("button", { hasText: /^co\s*Ask\b/ });
  const pill = page.getByText("0.0.0-fixture · alpha");
  for (const route of ["/", "/followups"]) {
    await page.goto(`${origin.origin}${route}`);
    await t.test(`${route}: the assistant launcher's name starts with its visible label`, async () => {
      await launcher.waitFor();
      const text = await voiceControlLabel(launcher);
      const name = await nameOf(launcher);
      assert.ok(norm(name).startsWith(norm(text)), `launcher shows "${text}" but is named "${name}"`);
    });
    await t.test(`${route}: the pre-release pill sits inside a landmark`, async () => {
      await pill.waitFor();
      const landmark = await pill.evaluate((el) => el.closest("aside, nav, main, header, footer, [role=region], [role=complementary], [role=navigation], [role=main], [role=banner], [role=contentinfo]")?.tagName ?? null);
      assert.ok(landmark, "pre-release pill is outside every landmark");
    });
  }

  const row = page.getByRole("row").filter({ hasText: "Fixture Beta" });
  for (const label of ["Log", "Next date"]) {
    await t.test(`/followups: the row's "${label}" button names its label and company`, async () => {
      const button = row.locator("button", { hasText: label });
      await button.waitFor();
      assert.equal(await button.count(), 1, `one "${label}" button in the Fixture Beta row`);
      const text = await voiceControlLabel(button);
      assert.equal(text, label, `"${label}" is visible at desktop width`);
      const name = await nameOf(button);
      assert.ok(norm(name).includes(norm(text)), `row button shows "${text}" but is named "${name}"`);
      assert.ok(name.includes("Fixture Beta"), `row button "${name}" does not say which company it acts on`);
    });
  }
  await t.test("/followups: the expand column header is named by its own text", async () => {
    const expandHeader = page.locator("thead th").first();
    const headerName = await nameOf(expandHeader);
    const headerText = await expandHeader.evaluate((el) => el.textContent.trim());
    assert.ok(headerText, `expand column header has no text for screen readers (name "${headerName}")`);
    assert.equal(norm(headerName), norm(headerText));
  });

  const jobsLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/scheduled-jobs");
  await page.goto(`${origin.origin}/scheduled-scans`);
  await jobsLoaded;
  await t.test("/scheduled-scans: heading levels never skip", async () => {
    await page.getByText("No scheduled scans found").waitFor();
    const levels = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1])));
    assert.equal(levels[0], 1, "page starts with an h1");
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] <= levels[i - 1] + 1, `heading levels skip from h${levels[i - 1]} to h${levels[i]} (${levels.join(", ")})`);
    }
  });

  assert.deepEqual(unexpected, []);
});
