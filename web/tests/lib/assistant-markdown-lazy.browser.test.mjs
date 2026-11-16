// Optional Chrome regression: start the built web server against disposable
// data, then ASSISTANT_MARKDOWN_LAZY_TEST_URL=http://127.0.0.1:3000 node --test this-file.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.ASSISTANT_MARKDOWN_LAZY_TEST_URL;
// micromark's token type and remark's extension key: both survive minification
// and appear only in the markdown parser's chunk.
const PARSER_SIGNATURES = ["setextUnderline", "micromarkExtensions"];
const hasParser = (body) => PARSER_SIGNATURES.some((s) => body.includes(s));

test("Assistant markdown loads only once the console opens", { skip: liveServerSkip("ASSISTANT_MARKDOWN_LAZY_TEST_URL"), timeout: 60_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const unexpected = [];
  await page.route("**/api/**", (route) => {
    if (route.request().method() === "GET") return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  let scripts = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
  });

  await page.goto(`${origin.origin}/config`, { waitUntil: "networkidle" });
  const beforeOpen = await Promise.all(scripts);
  assert.ok(beforeOpen.length > 0, "page loaded its scripts");
  assert.equal(beforeOpen.filter(hasParser).length, 0, "no script loaded before opening the assistant contains the markdown parser");

  scripts = [];
  await page.getByRole("button", { name: "Ask the assistant", exact: true }).click();
  const panel = page.getByRole("region", { name: "Assistant", exact: true });
  const greeting = panel.locator(".report-prose p", { hasText: "I'm your career-ops assistant" });
  await greeting.waitFor({ state: "visible" });
  assert.match(await greeting.innerText(), /What would you like to do\?$/);
  assert.ok((await Promise.all(scripts)).some(hasParser), "opening the assistant loads the markdown parser");
  assert.deepEqual(unexpected, []);
});
