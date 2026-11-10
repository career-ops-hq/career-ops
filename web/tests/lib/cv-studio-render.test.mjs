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

function setup(file, { fail, overflow = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-render-"));
  fs.mkdirSync(path.join(root, "output"));
  fs.writeFileSync(path.join(root, "output", file), HTML);
  fs.writeFileSync(
    path.join(root, "generate-pdf.mjs"),
    fail
      ? `process.stderr.write("render failed"); process.exit(1);`
      // A render over a warn-only page budget (#6377): exit 0, the PDF at a
      // sibling draft, nothing written to the output path, and the draft named
      // on stderr the way generate-pdf.mjs names it.
      : overflow
        ? `import fs from "node:fs"; const draft = process.argv[3].replace(/\\.pdf$/, ".overflow.pdf"); fs.writeFileSync(draft, "%PDF draft");
           process.stderr.write("⚠️  CV is 2 pages; the allowed maximum is 1 page. Trim lower-priority bullets, older roles, secondary projects, or the competencies strip, then regenerate. Overflow is warning-only by default; use --strict-pages to reject it.\\n⚠️  Overflow draft: " + draft + " (nothing was written to the output path). Trim and rerun to write " + process.argv[3] + ".\\n");`
        : `import fs from "node:fs"; fs.writeFileSync(process.argv[3], "%PDF");`,
  );
  // The stub records every run, so a test can assert the tracker was not marked.
  fs.writeFileSync(path.join(root, "mark-pdf-ready.mjs"), `import fs from "node:fs"; fs.writeFileSync(new URL("./marked", import.meta.url), ""); console.log("{}");`);
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
  // The stub scripts stand in for the code checkout, which is where the render
  // looks for them; the temp dir is both roots here.
  const previousCodeRoot = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_CODE_ROOT = root;
  const out = (name) => path.join(root, "output", name);
  const marked = () => fs.existsSync(path.join(root, "marked"));
  const cleanup = () => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    if (previousCodeRoot === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previousCodeRoot;
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { load, out, marked, cleanup };
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


test("a render over a warn-only page budget is not a success: no edited PDF, tracker not marked, edited HTML restored", async () => {
  // generate-pdf.mjs exits 0 but kept the render as a sibling draft (#6377):
  // the exit code alone would keep the edited HTML, mark the tracker ready and
  // report a PDF that was never written.
  const { load, out, marked, cleanup } = setup("cv-acme.html", { fail: false, overflow: true });
  try {
    fs.writeFileSync(out("cv-acme-edited.html"), "html of the last good render");
    fs.writeFileSync(out("cv-acme-edited.pdf"), "%PDF last good render");
    const result = await renderEditedPdf(load, load.edits);
    assert.equal(result.ok, false);
    assert.match(result.error, /^CV is 2 pages; the allowed maximum is 1 page\. No PDF was written; the over-budget draft is cv-acme-edited\.overflow\.pdf\./);
    assert.equal(fs.readFileSync(out("cv-acme-edited.html"), "utf8"), "html of the last good render", "the edited HTML matches the PDF that is there");
    assert.equal(fs.readFileSync(out("cv-acme-edited.pdf"), "utf8"), "%PDF last good render", "the previous PDF is untouched");
    assert.equal(marked(), false, "the tracker is not marked for a PDF that was never written");
  } finally {
    cleanup();
  }
});
