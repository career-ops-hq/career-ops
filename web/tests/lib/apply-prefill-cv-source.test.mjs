/**
 * apply-prefill-cv-source.test.mjs — the two halves of one application must
 * describe the same document.
 *
 * /api/apply/fill uploads the tailored CV that `pdf` mode built for this offer,
 * resolved by resolveTailoredCv(). /api/apply/prefill drafts the structured
 * answers typed into that same form. When the prompt sends the planner to master
 * cv.md, a reviewer reads a resume and a set of answers that disagree: bullets
 * are reselected per offer, role framing is rewritten toward the employer's
 * domain, and engagements are regrouped. The candidate never sees the mismatch,
 * because both halves look right on their own.
 *
 * So the assertion is a join, not a wording check: resolve the CV the fill route
 * attaches, then require the prefill prompt to name that document.
 *
 * applyCvSource() is the seam between them. It reads the `pdf` column of
 * data/pdf-index.tsv and answers with the row's readable rendering, so the
 * planner gets a document it can actually open.
 *
 * Run (from web/):  node --test tests/lib/apply-prefill-cv-source.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

// cv.ts reaches web/src/lib/career-ops through the `@/` path alias, and bare
// `node --test` has no webpack in the loop to resolve it. Same inline loader
// apply-cv-resolver.test.mjs registers, for the same reason.
const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const ALIAS_EXTS = [".ts", ".tsx", ".mjs", ".js", ".mts"];
const loaderSrc = [
  "import { existsSync } from 'node:fs';",
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  `const WEB_SRC = ${JSON.stringify(WEB_SRC)};`,
  `const EXTS = ${JSON.stringify(ALIAS_EXTS)};`,
  "function resolveWithExt(base) {",
  "  for (const ext of EXTS) { if (existsSync(base + ext)) return base + ext; }",
  "  if (existsSync(base)) return base;",
  "  return null;",
  "}",
  "export async function resolve(specifier, context, nextResolve) {",
  "  if (specifier.startsWith('@/')) {",
  "    const rel = specifier.slice(2);",
  "    const base = path.join(WEB_SRC, rel);",
  "    const resolved = resolveWithExt(base);",
  "    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };",
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
].join("\n");
register("data:text/javascript," + encodeURIComponent(loaderSrc), pathToFileURL(WEB_SRC + "/"));

const { resolveTailoredCv } = await import("../../src/lib/apply/cv.ts");
const { buildAnswerPrompt } = await import("../../src/lib/apply/answer-prompt.mjs");
const { applyCvSource } = await import("../../src/lib/apply/cv-source.mjs");

const FIELDS = [
  { id: "f1", type: "text", label: "Full name", required: true },
  { id: "f2", type: "textarea", label: "Describe your most recent role", required: true },
];

const PDF_REL = "output/cv-acme-corp-2026-01-10.pdf";
const HTML_REL = "output/cv-acme-corp-2026-01-10.html";

/** A throwaway workspace holding one tailored CV and the manifest row that
 *  generate-pdf.mjs writes for it, redirected through CAREER_OPS_ROOT. */
async function withWorkspace(fn, { html = true, manifest = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "prefill-cv-"));
  mkdirSync(join(root, "output"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "cv.md"), "# Master CV\n");
  writeFileSync(join(root, PDF_REL), "stub-pdf-bytes");
  if (html) writeFileSync(join(root, HTML_REL), "<html>tailored</html>");
  if (manifest) {
    writeFileSync(
      join(root, "data", "pdf-index.tsv"),
      "# report\tpdf\thtml\tformat\tdate — written by generate-pdf.mjs, do not edit\n" +
        `12\t${PDF_REL}\t${HTML_REL}\tletter\t2026-01-10\n`,
    );
  }
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    return await fn(root);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
  }
}

test("the prefill prompt names the very document the fill route attaches", async () => {
  await withWorkspace(async (root) => {
    const attached = await resolveTailoredCv("Acme Corp");
    assert.ok(attached, "fixture is wrong: the fill route found no tailored CV to attach");

    const cvSource = applyCvSource(root, attached);
    const prompt = buildAnswerPrompt({ title: "Acme Corp — Staff Engineer", fields: FIELDS, cvSource });

    assert.ok(
      prompt.includes(cvSource),
      `the planner drafts answers the reviewer reads beside the attached CV, so the prompt must name it (${cvSource})`,
    );
    assert.ok(
      !/Read cv\.md/.test(prompt),
      "master cv.md was named as the source while a tailored CV is being uploaded to the same form",
    );
    assert.match(prompt, /cv\.md is the fallback only/);
  });
});

test("with no tailored CV, the prompt still sends the planner to cv.md", async () => {
  await withWorkspace(async () => {
    const attached = await resolveTailoredCv("Nothing Built Here");
    assert.equal(attached, null);

    const prompt = buildAnswerPrompt({ title: "Nothing Built Here — Staff Engineer", fields: FIELDS, cvSource: null });
    assert.match(prompt, /Read cv\.md/);
  });
});

test("applyCvSource answers with the manifest's readable rendering of that exact PDF", async () => {
  await withWorkspace(async (root) => {
    assert.equal(applyCvSource(root, join(root, PDF_REL)), HTML_REL);
    assert.equal(applyCvSource(root, PDF_REL), HTML_REL, "a root-relative path resolves the same row");
  });
});

test("applyCvSource falls back to the PDF when no rendering survives", async () => {
  // A CV built through the latex path never gets an html sibling. "No readable
  // rendering" is not "no tailored CV", and treating them alike puts the
  // contradiction back.
  await withWorkspace(
    async (root) => {
      assert.equal(applyCvSource(root, PDF_REL), PDF_REL);
    },
    { html: false, manifest: false },
  );
});

test("applyCvSource refuses a path outside the workspace", async () => {
  await withWorkspace(async (root) => {
    assert.equal(applyCvSource(root, "../../etc/passwd"), null);
    assert.equal(applyCvSource(root, ""), null);
    assert.equal(applyCvSource(root, undefined), null);
  });
});

test("the sensitive-field carve-out survives the tailored-CV wording", async () => {
  // The one line standing between an auto-filler and a fabricated visa or salary
  // answer. It fails silently, so it is pinned on both branches.
  await withWorkspace(async (root) => {
    const attached = await resolveTailoredCv("Acme Corp");
    for (const cvSource of [applyCvSource(root, attached), null]) {
      const prompt = buildAnswerPrompt({ title: "Acme Corp", fields: FIELDS, cvSource });
      for (const category of ["legal", "visa", "work-authorization", "salary", "demographic"]) {
        assert.ok(prompt.includes(category), `cvSource=${cvSource}: lost the ${category} carve-out`);
      }
      assert.match(prompt, /NEVER fill[^\n]*needs_confirmation:true and value:""/);
    }
  });
});
