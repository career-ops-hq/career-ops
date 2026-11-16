// A trailing star marks the field required. A star inside the question does not.
// Served only on 127.0.0.1:3167. The unlabeled-radio test uses 3165.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-star-required.test.mjs

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { toolRequired } from "../../../tests/required-tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../fixtures/apply-star-required.html"), "utf8");
const PORT = 3167;
const longStar = `${"A".repeat(160)} *`;
const innerStar = `${"A".repeat(159)}* optional`;
const longRadio = `${"B".repeat(160)} *`;
const innerRadio = `${"C".repeat(159)}* and more`;
const longOption = `${"D".repeat(160)} *`;
const sharedPrefix = "E".repeat(161);
const sharedQuestion = `${sharedPrefix} Do you agree? *`;
const sharedOption = `${sharedPrefix} I agree`;
const wrappedOption = `${"F".repeat(160)} yes`;
const directOption = `${"G".repeat(160)} yes`;

test("a trailing star marks the field required", async (t) => {
  const pageHtml = html.replace("</form>", `
  <label for="long-star">${longStar}</label>
  <input id="long-star" name="long-star" type="text">
  <label for="inner-star">${innerStar}</label>
  <input id="inner-star" name="inner-star" type="text">
  <div class="field">
    <p class="question">${longRadio}</p>
    <label><input type="radio" name="longq" value="1"> Yes</label>
    <label><input type="radio" name="longq" value="0"> No</label>
  </div>
  <div class="field">
    <p class="question">${innerRadio}</p>
    <label><input type="radio" name="innerq" value="1"> Yes</label>
    <label><input type="radio" name="innerq" value="0"> No</label>
  </div>
  <div class="field">
    <label><input type="radio" name="longopt" value="1"> ${longOption}</label>
    <label><input type="radio" name="longopt" value="0"> No</label>
  </div>
  <div class="field">
    <p class="question">${sharedQuestion}</p>
    <label><input type="radio" name="sharedq" value="1"> ${sharedOption}</label>
    <label><input type="radio" name="sharedq" value="0"> No</label>
  </div>
  <div class="field">
    <div class="heading">
      <p class="question-title">Eligibility *</p>
      <label><input type="radio" name="elig" value="1"> ${wrappedOption}</label>
      <label><input type="radio" name="elig" value="0"> No</label>
    </div>
  </div>
  <div class="field">
    <div class="heading">
      Work authorization *
      <label><input type="radio" name="workauth" value="1"> ${directOption}</label>
      <label><input type="radio" name="workauth" value="0"> No</label>
    </div>
  </div>
  <div class="field">
    <div class="heading">
      <p class="question-title">Sponsorship *</p>
      <input type="radio" id="spon-yes" name="spon" value="1">
      <label for="spon-yes">Yes</label>
      <input type="radio" id="spon-no" name="spon" value="0">
      <label for="spon-no">No</label>
    </div>
  </div>
</form>`);
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
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
    const form = await extractForm(page.mainFrame());
    const byLabel = Object.fromEntries(form.fields.map((f) => [f.label, f.required]));
    assert.equal(byLabel["Phone *"], true);
    assert.equal(byLabel["What is 2 * 3"], false);
    assert.equal(byLabel.Email, true);
    assert.equal(byLabel["A".repeat(160)], true);
    assert.equal(byLabel[`${"A".repeat(159)}*`], false);
    const longQ = form.fields.find((f) => f.type === "radio" && f.label === "B".repeat(160));
    const innerQ = form.fields.find((f) => f.type === "radio" && f.label === `${"C".repeat(159)}*`);
    assert.ok(longQ);
    assert.equal(longQ.required, true);
    assert.ok(innerQ);
    assert.equal(innerQ.required, false);
    const longOpt = form.fields.find((f) => f.type === "radio" && f.options?.includes("D".repeat(160)));
    assert.ok(longOpt);
    assert.equal(longOpt.label, "longopt");
    assert.equal(longOpt.required, false);
    const shared = form.fields.find((f) => f.type === "radio" && f.label === "E".repeat(160));
    assert.ok(shared);
    assert.equal(shared.required, true);
    const wrapped = form.fields.find((f) => f.type === "radio" && f.options?.includes("F".repeat(160)));
    assert.ok(wrapped);
    assert.equal(wrapped.label, "Eligibility *");
    assert.equal(wrapped.required, true);
    const direct = form.fields.find((f) => f.type === "radio" && f.options?.includes("G".repeat(160)));
    assert.ok(direct);
    assert.equal(direct.label, "Work authorization *");
    assert.equal(direct.required, true);
    const sibling = form.fields.find((f) => f.type === "radio" && (f.label || "").includes("Sponsorship"));
    assert.ok(sibling);
    assert.equal(sibling.label, "Sponsorship *");
    assert.equal(sibling.required, true);
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
