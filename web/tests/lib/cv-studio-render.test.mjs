// A stub generate-pdf.mjs in a temporary root stands in for the real renderer,
// so each test picks whether the render succeeds.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
import { parseBlocks } from "../../src/lib/cv-studio/html-blocks.mjs";
import { buildStudioDoc, emptyEdits } from "../../src/lib/cv-studio/studio.mjs";

const { renderEditedPdf } = await import("../../src/lib/cv-studio/server.ts");

const HTML = `<html><body><div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
  <div class="job-header"><span class="job-company">Acme</span></div>
  <ul>
    <li>Built the data pipeline</li>
  </ul>
</div>
  </div></body></html>`;

function setup(file, { fail }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-render-"));
  fs.mkdirSync(path.join(root, "output"));
  fs.writeFileSync(path.join(root, "output", file), HTML);
  fs.writeFileSync(
    path.join(root, "generate-pdf.mjs"),
    fail
      ? `process.stderr.write("render failed"); process.exit(1);`
      : `import fs from "node:fs"; fs.writeFileSync(process.argv[3], "%PDF");`,
  );
  fs.writeFileSync(path.join(root, "mark-pdf-ready.mjs"), `console.log("{}");`);
  const tree = parseBlocks(HTML);
  const doc = buildStudioDoc({
    tree,
    base: { summary: null, entries: [] },
    keywords: [],
    sourceHash: "h1",
    keywordsIn: () => [],
    itemText: () => "",
    fixedText: "",
  });
  const load = { ok: true, reportNum: "007", company: "Acme", file, tree, doc, edits: emptyEdits("h1"), stale: false, hasBase: false };
  const previousRoot = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  const out = (name) => path.join(root, "output", name);
  const cleanup = () => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { load, out, cleanup };
}

test("an upper-case .HTML tailored CV renders to an -edited copy and keeps the original", async () => {
  const { load, out, cleanup } = setup("cv-acme.HTML", { fail: false });
  try {
    fs.writeFileSync(out("cv-acme.HTML"), "original tailor output");
    const result = await renderEditedPdf(load, load.edits);
    assert.equal(result.ok, true);
    assert.equal(result.pdf, "cv-acme-edited.pdf");
    assert.equal(fs.readFileSync(out("cv-acme.HTML"), "utf8"), "original tailor output");
    assert.equal(fs.readFileSync(out("cv-acme-edited.pdf"), "utf8"), "%PDF");
  } finally {
    cleanup();
  }
});

test("a failed first render leaves no edited HTML behind", async () => {
  const { load, out, cleanup } = setup("cv-acme.html", { fail: true });
  try {
    const result = await renderEditedPdf(load, load.edits);
    assert.deepEqual(result, { ok: false, error: "render failed" });
    assert.equal(fs.existsSync(out("cv-acme-edited.html")), false);
  } finally {
    cleanup();
  }
});

test("a failed re-render keeps the edited HTML that matches the previous PDF", async () => {
  const { load, out, cleanup } = setup("cv-acme.html", { fail: true });
  try {
    fs.writeFileSync(out("cv-acme-edited.html"), "html of the last good render");
    fs.writeFileSync(out("cv-acme-edited.pdf"), "%PDF last good render");
    const result = await renderEditedPdf(load, load.edits);
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(out("cv-acme-edited.html"), "utf8"), "html of the last good render");
  } finally {
    cleanup();
  }
});
