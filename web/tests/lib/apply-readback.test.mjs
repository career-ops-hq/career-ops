// A checked radio used to count as filled even when it was the other option,
// and a combobox with nothing readable counted as the answer we hoped for.
// The green banner then said the form was pre-filled.
//
// Run from web/: node --test tests/lib/apply-readback.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { showPrefilledBanner } from "../../src/lib/apply/prefilled-banner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, "../fixtures/apply-readback.html"), "utf8");

const fields = [
  { id: "name", type: "text", label: "First name", required: true },
  { id: "visa", type: "radio", label: "Will you now or in the future require visa sponsorship?", required: true, options: ["Yes", "No"] },
  { id: "agree", type: "checkbox", label: "I agree to the privacy notice", required: false },
  { id: "office", type: "select", label: "Office", required: true, combobox: true },
];

function codes(issues) {
  return issues.map((issue) => issue.code);
}

test("the green banner stays off unless read-back passed", () => {
  assert.equal(showPrefilledBanner("done", []), true);
  assert.equal(showPrefilledBanner("ready", []), false);
  assert.equal(showPrefilledBanner("done", [{ code: "fill-mismatch" }]), false);
  assert.equal(showPrefilledBanner("done", [{ code: "required-empty" }]), false);
  assert.equal(showPrefilledBanner("done", [{ code: "fill-unverified" }]), false);
  assert.equal(showPrefilledBanner("done", [{ code: "captcha-present" }]), true);
});

test("a wrong radio and an unread combobox are not a successful read-back", async (t) => {
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

  const { chromium } = await import("playwright-core");
  const { verifyFill } = await import("../../src/lib/apply/diagnose.ts");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/apply-readback.html`);

  const wrong = await verifyFill(page.mainFrame(), fields, {
    name: "Fixture",
    visa: "No",
    agree: "yes",
    office: "Springfield, IL",
  });
  assert.ok(codes(wrong).includes("fill-mismatch"), JSON.stringify(wrong));
  assert.match(wrong.find((issue) => issue.code === "fill-mismatch").message, /visa sponsorship/);
  assert.ok(codes(wrong).includes("fill-unverified"), JSON.stringify(wrong));
  assert.equal(showPrefilledBanner("done", wrong), false);

  await page.locator("#wrong").evaluate((form) => { form.remove(); });
  documentUnhide(page);
  await page.locator("#right").evaluate((form) => { form.hidden = false; });
  const right = await verifyFill(page.mainFrame(), fields.filter((field) => field.id !== "agree"), {
    name: "Fixture",
    visa: "No",
    office: "Springfield, IL",
  });
  assert.deepEqual(codes(right).filter((code) => code !== "validation"), []);
  assert.equal(showPrefilledBanner("done", right.filter((issue) => issue.code !== "validation")), true);
});

async function documentUnhide(page) {
  await page.locator("#right").evaluate((form) => { form.hidden = false; });
}
