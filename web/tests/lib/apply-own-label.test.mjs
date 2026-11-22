import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, "../fixtures/apply-own-label.html"), "utf8");

test("each input in a shared wrapper keeps its own name", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fixtureHtml);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (err) {
    t.skip(`Chrome did not start: ${err instanceof Error ? err.message : err}`);
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/apply-own-label.html`, { waitUntil: "domcontentloaded" });
  const { extractForm } = await import("../../src/lib/apply/extract.ts");
  const form = await extractForm(page.mainFrame());
  const labels = form.fields.map((field) => field.label);
  assert.deepEqual(labels, ["given", "family", "contact", "resume", "City", "Department", "Team", "Office", "Role"]);
});
