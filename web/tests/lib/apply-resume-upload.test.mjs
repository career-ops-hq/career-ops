import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Node strips types, but the session's imports use Next aliases and omit .ts.
const src = join(dirname(fileURLToPath(import.meta.url)), "../../src");
register(`data:text/javascript,${encodeURIComponent(`
  import { existsSync } from 'node:fs';
  import { pathToFileURL, fileURLToPath } from 'node:url';
  import path from 'node:path';
  export async function resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith('@/')
      ? path.join(${JSON.stringify(src)}, specifier.slice(2))
      : specifier.startsWith('.') ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (base) {
      for (const ext of ['', '.ts', '.mjs', '.js']) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`)}`, pathToFileURL(src + "/"));

const { fillSession } = await import("../../src/lib/apply/session.ts");
const resume = { id: "resume", type: "file", label: "Resume", required: true };
const cover = { id: "cover", type: "file", label: "Cover letter", required: false };

async function withSession(frame, page, fn) {
  const id = `fixture-${crypto.randomUUID()}`;
  globalThis.__coApplySessions.set(id, { id, frame, page });
  try {
    return await fn(id);
  } finally {
    globalThis.__coApplySessions.delete(id);
  }
}

for (const exactFails of [false, true]) {
  test(`CV upload ${exactFails ? "failure never targets another file field" : "uses the tagged resume input"}`, async () => {
    const uploads = [];
    const frame = {
      url: () => "about:blank",
      locator: (selector) => ({ first: () => ({ setInputFiles: async (file) => {
        if (exactFails && selector === '[data-co-field="resume"]') throw new Error("tagged input replaced");
        uploads.push({ selector, file });
      } }) }),
      evaluate: async () => ({ mismatches: [], requiredEmpty: [], valErrors: [] }),
    };
    const page = { screenshot: async () => Buffer.from("fixture") };
    const result = await withSession(frame, page, (id) => fillSession(id, {}, [cover, resume], "/fixture/cv.pdf"));
    assert.deepEqual(uploads, exactFails ? [] : [{ selector: '[data-co-field="resume"]', file: "/fixture/cv.pdf" }]);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].fieldId, "resume");
    assert.equal(result.steps[0].ok, !exactFails);
  });
}

// Opt-in browser proof: only local DOM and disposable documents; no ATS or CLI.
test("a re-rendered resume field never receives its CV through the cover input", { skip: !process.env.APPLY_UPLOAD_BROWSER_TEST }, async (t) => {
  const { chromium } = await import("playwright-core");
  const { extractForm } = await import("../../src/lib/apply/extract.ts");
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(200);
  await page.setContent('<label for="cover">Cover letter</label><input id="cover" type="file"><label for="resume">Resume</label><input id="resume" type="file">');
  const form = await extractForm(page.mainFrame());
  assert.equal(form.fields.length, 2);
  const root = mkdtempSync(join(tmpdir(), "apply-upload-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pdf = join(root, "cv-fixture.pdf");
  writeFileSync(pdf, "%PDF-1.4\nfictional fixture\n");

  // Valid extracted controls still receive the CV only in the resume field.
  const good = await withSession(page.mainFrame(), page, (id) => fillSession(id, {}, form.fields, pdf));
  assert.equal(good.steps[0].ok, true);
  assert.equal(await page.locator("#resume").evaluate((el) => el.files.length), 1);
  assert.equal(await page.locator("#cover").evaluate((el) => el.files.length), 0);

  // ATS hydration replaces an input after extraction, losing data-co-field.
  await page.locator("#resume").evaluate((el) => el.outerHTML = '<input id="resume" type="file">');
  const failed = await withSession(page.mainFrame(), page, (id) => fillSession(id, {}, form.fields, pdf));
  assert.equal(await page.locator("#cover").evaluate((el) => el.files.length), 0, "the CV must not land in the cover-letter field");
  assert.equal(await page.locator("#resume").evaluate((el) => el.files.length), 0);
  assert.equal(failed.steps[0].ok, false);
});
