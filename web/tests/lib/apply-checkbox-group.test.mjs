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
    const { verifyFill } = await import("../../src/lib/apply/diagnose.ts");
    const form = await extractForm(page.mainFrame());
    assert.equal(form.title, "Northwind application");
    const boxes = form.fields.filter((f) => f.type === "checkbox");
    assert.equal(boxes.length, 6);
    const benefits = boxes.find((f) => f.label === "Which Northwind benefits do you want?");
    const perks = boxes.find((f) => f.label === "Perks");
    const teams = boxes.find((f) => f.label === "Teams");
    const acks = boxes.find((f) => f.label === "Acknowledgements");
    const notices = boxes.find((f) => f.label === "Notices");
    const consent = boxes.find((f) => /privacy notice/i.test(f.label) && !f.options);
    assert.ok(benefits);
    assert.equal(benefits.label, "Which Northwind benefits do you want?");
    assert.deepEqual(benefits.options, ["Health", "Dental"]);
    assert.ok(perks);
    assert.deepEqual(perks.options, ["health", "dental"]);
    assert.ok(teams);
    assert.deepEqual(teams.options, ["Sales, Marketing", "Engineering"]);
    assert.ok(acks);
    assert.deepEqual(acks.options, ["Health insurance", "I agree to the privacy notice"]);
    assert.ok(notices);
    assert.deepEqual(notices.options, ["processing", "sharing"]);
    assert.equal(await page.locator('input[name="notices"][value="processing"]').getAttribute("data-co-consent"), "1");
    assert.equal(await page.locator('input[name="notices"][value="sharing"]').getAttribute("data-co-consent"), "1");
    assert.equal(await page.locator('input[name="perks"][value="health"]').getAttribute("data-co-consent"), null);
    assert.ok(consent);
    assert.equal(consent.label, "I agree to the privacy notice");
    assert.equal(consent.options, undefined);
    const id = `fixture-${crypto.randomUUID()}`;
    globalThis.__coApplySessions.set(id, { id, frame: page.mainFrame(), page });
    try {
      const filled = await fillSession(id, { [benefits.id]: "Health" }, form.fields);
      assert.equal(filled.steps.find((s) => s.fieldId === benefits.id)?.ok, true);
      assert.equal(await page.locator('input[name="benefits"][value="health"]').isChecked(), true);
      assert.equal(await page.locator('input[name="benefits"][value="dental"]').isChecked(), false);
      assert.equal(await page.locator("#consent").isChecked(), false);
      const missed = await fillSession(id, { [benefits.id]: "Health, Vision" }, form.fields);
      assert.equal(missed.steps.find((s) => s.fieldId === benefits.id)?.ok, false);
      assert.equal(await page.locator('input[name="benefits"][value="dental"]').isChecked(), false);
      const onlyDental = await fillSession(id, { [benefits.id]: "Dental" }, form.fields);
      assert.equal(onlyDental.steps.find((s) => s.fieldId === benefits.id)?.ok, true);
      assert.equal(await page.locator('input[name="benefits"][value="health"]').isChecked(), false);
      assert.equal(await page.locator('input[name="benefits"][value="dental"]').isChecked(), true);
      const readback = await verifyFill(page.mainFrame(), form.fields, { [benefits.id]: "Dental" });
      assert.equal(readback.some((issue) => issue.code === "fill-mismatch"), false);
      const wrong = await verifyFill(page.mainFrame(), form.fields, { [benefits.id]: "Health" });
      assert.equal(wrong.some((issue) => issue.code === "fill-mismatch" && /benefits/i.test(issue.message)), true);
      const perksFilled = await fillSession(id, { [perks.id]: "health" }, form.fields);
      assert.equal(perksFilled.steps.find((s) => s.fieldId === perks.id)?.ok, true);
      assert.equal(await page.locator('input[name="perks"][value="health"]').isChecked(), true);
      assert.equal(await page.locator('input[name="perks"][value="dental"]').isChecked(), false);
      const teamFilled = await fillSession(id, { [teams.id]: "Sales, Marketing" }, form.fields);
      assert.equal(teamFilled.steps.find((s) => s.fieldId === teams.id)?.ok, true);
      assert.equal(await page.locator('input[name="teams"][value="sm"]').isChecked(), true);
      assert.equal(await page.locator('input[name="teams"][value="eng"]').isChecked(), false);
      const bothTeams = await fillSession(id, { [teams.id]: "Sales, Marketing, Engineering" }, form.fields);
      assert.equal(bothTeams.steps.find((s) => s.fieldId === teams.id)?.ok, true);
      assert.equal(await page.locator('input[name="teams"][value="sm"]').isChecked(), true);
      assert.equal(await page.locator('input[name="teams"][value="eng"]').isChecked(), true);
      const teamRead = await verifyFill(page.mainFrame(), form.fields, { [teams.id]: "Sales, Marketing, Engineering" });
      assert.equal(teamRead.some((issue) => issue.code === "fill-mismatch"), false);
      const noticeFilled = await fillSession(id, { [notices.id]: "processing" }, form.fields);
      assert.equal(noticeFilled.steps.find((s) => s.fieldId === notices.id)?.ok, false);
      assert.equal(await page.locator('input[name="notices"][value="processing"]').isChecked(), false);
      assert.equal(await page.locator('input[name="notices"][value="sharing"]').isChecked(), false);
      const ackFilled = await fillSession(id, { [acks.id]: "Health insurance, I agree to the privacy notice" }, form.fields);
      assert.equal(ackFilled.steps.find((s) => s.fieldId === acks.id)?.ok, false);
      assert.equal(await page.locator('input[name="acks"][value="cover"]').isChecked(), true);
      assert.equal(await page.locator('input[name="acks"][value="privacy"]').isChecked(), false);
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
