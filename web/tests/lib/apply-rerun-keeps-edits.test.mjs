// A second fill must not replace a value the person typed on the form.
// Served only on 127.0.0.1:3166. The unlabeled-radio test uses 3165.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-rerun-keeps-edits.test.mjs

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../fixtures/apply-rerun-salary.html"));
const PORT = 3166;

test("a second fill keeps a salary the person changed by hand", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    const { extractForm } = await import("../../src/lib/apply/extract.ts");
    const { fillSession } = await import("../../src/lib/apply/session.ts");
    const form = await extractForm(page.mainFrame());
    const salary = form.fields.find((f) => f.label === "Desired salary");
    const email = form.fields.find((f) => f.label === "Email");
    assert.ok(salary);
    assert.ok(email);
    const id = `fixture-${crypto.randomUUID()}`;
    globalThis.__coApplySessions.set(id, { id, frame: page.mainFrame(), page });
    try {
      await fillSession(id, { [salary.id]: "180000", [email.id]: "fixture-inbox" }, form.fields);
      assert.equal(await page.locator("#salary").inputValue(), "180000");
      assert.equal(await page.locator("#email").inputValue(), "fixture-inbox");
      await page.locator("#salary").fill("1");
      await fillSession(id, { [salary.id]: "180000", [email.id]: "fixture-inbox" }, form.fields);
      assert.equal(await page.locator("#salary").inputValue(), "1");
      assert.equal(await page.locator("#email").inputValue(), "fixture-inbox");
    } finally {
      globalThis.__coApplySessions.delete(id);
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
