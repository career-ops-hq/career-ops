// Radios with no choice label must still check Yes or No. Labeled radios keep
// the visible word, not the machine value.
// Served only on 127.0.0.1:3165.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-unlabeled-radios.test.mjs

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../fixtures/apply-unlabeled-radios.html"));
const PORT = 3165;

test("unlabeled radios check Yes, and labeled radios keep their words", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    const { extractForm } = await import("../../src/lib/apply/extract.ts");
    const { fillSession } = await import("../../src/lib/apply/session.ts");
    const form = await extractForm(page.mainFrame());
    const auth = form.fields.find((f) => f.type === "radio" && /authorized/i.test(f.label));
    const rel = form.fields.find((f) => f.type === "radio" && /relocate/i.test(f.label));
    assert.ok(auth);
    assert.deepEqual(auth.options, ["Yes", "No"]);
    assert.ok(rel);
    assert.deepEqual(rel.options, ["Yes", "No"]);
    const visa = form.fields.find((f) => f.type === "radio" && f.label === "visa");
    assert.ok(visa);
    assert.deepEqual(visa.options, ["Yes", "No"]);
    const id = `fixture-${crypto.randomUUID()}`;
    globalThis.__coApplySessions.set(id, { id, frame: page.mainFrame(), page });
    try {
      const filled = await fillSession(id, { [auth.id]: "Yes" }, form.fields);
      assert.equal(filled.steps.find((s) => s.fieldId === auth.id)?.ok, true);
      const checked = await page.locator('input[name="auth"]:checked').inputValue();
      assert.equal(checked, "Yes");
    } finally {
      globalThis.__coApplySessions.delete(id);
    }
  } finally {
    await browser.close();
  }
});
