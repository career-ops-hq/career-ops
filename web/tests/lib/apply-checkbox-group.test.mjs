// Checkboxes that share a name stay one question. A lone consent box keeps its label.
// Served only on 127.0.0.1:3168.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-checkbox-group.test.mjs

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { toolRequired } from "../../../tests/required-tools.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../fixtures/apply-checkbox-group.html"));
const PORT = 3168;

test("a checkbox group keeps the legend, and one consent box stays alone", async (t) => {
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
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (toolRequired("browser")) throw err;
      t.skip(`system Chrome did not launch (${reason})`);
      return;
    }
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    const { extractForm } = await import("../../src/lib/apply/extract.ts");
    const { fillSession } = await import("../../src/lib/apply/session.ts");
    const form = await extractForm(page.mainFrame());
    assert.equal(form.title, "Northwind application");
    const boxes = form.fields.filter((f) => f.type === "checkbox");
    assert.equal(boxes.length, 2);
    const benefits = boxes.find((f) => f.options);
    const consent = boxes.find((f) => /privacy notice/i.test(f.label));
    assert.ok(benefits);
    assert.equal(benefits.label, "Which Northwind benefits do you want?");
    assert.deepEqual(benefits.options, ["Health", "Dental"]);
    assert.ok(consent);
    assert.equal(consent.label, "I agree to the privacy notice");
    assert.equal(consent.options, undefined);
    const id = `fixture-${crypto.randomUUID()}`;
    globalThis.__coApplySessions.set(id, { id, frame: page.mainFrame(), page });
    try {
      const filled = await fillSession(id, { [benefits.id]: "Health" }, form.fields);
      assert.equal(filled.steps.find((s) => s.fieldId === benefits.id)?.ok, true);
      assert.equal(await page.locator('input[value="health"]').isChecked(), true);
      assert.equal(await page.locator('input[value="dental"]').isChecked(), false);
      assert.equal(await page.locator("#consent").isChecked(), false);
      const missed = await fillSession(id, { [benefits.id]: "Health, Vision" }, form.fields);
      assert.equal(missed.steps.find((s) => s.fieldId === benefits.id)?.ok, false);
      assert.equal(await page.locator('input[value="dental"]').isChecked(), false);
    } finally {
      globalThis.__coApplySessions.delete(id);
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
