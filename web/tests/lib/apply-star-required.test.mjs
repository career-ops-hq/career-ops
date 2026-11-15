// A trailing star marks the field required. A star inside the question does not.
// Served only on 127.0.0.1:3165.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-star-required.test.mjs

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../fixtures/apply-star-required.html"));
const PORT = 3165;

test("a trailing star marks the field required", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    const { extractForm } = await import("../../src/lib/apply/extract.ts");
    const form = await extractForm(page.mainFrame());
    const byLabel = Object.fromEntries(form.fields.map((f) => [f.label, f.required]));
    assert.equal(byLabel["Phone *"], true);
    assert.equal(byLabel["What is 2 * 3"], false);
    assert.equal(byLabel.Email, true);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
