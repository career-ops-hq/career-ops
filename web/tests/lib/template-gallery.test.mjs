// The Templates gallery on /config (#1692): list the CV templates the core
// resolves, preview each one filled with a fictional resume, and set the default.
//
// Every case runs against the REAL core in this checkout (cv-templates.mjs and
// build-cv-html.mjs) with a scratch profile.yml, because the gallery's job is to
// agree with what the CLI would pick and render, and a stand-in for either side
// would agree with itself.
//
// Run:  node --test tests/lib/template-gallery.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listCvTemplates,
  profileWithCvTemplate,
  renderTemplatePreview,
  assertSelectableTemplate,
  withPreviewCsp,
} from "../../src/lib/template-gallery.mjs";
import { SAMPLE_CV_PAYLOAD } from "../../src/lib/template-sample-resume.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function scratchProfile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-gallery-"));
  const file = path.join(dir, "profile.yml");
  if (text !== null) fs.writeFileSync(file, text);
  return file;
}

test("lists the shipped CV templates and marks the profile's choice as the default", async () => {
  const profilePath = scratchProfile("cv:\n  template: modern\n");

  const { templates, defaultName } = await listCvTemplates(CORE, { profilePath });

  const names = templates.map((t) => t.name);
  assert.ok(names.includes("standard"));
  assert.ok(names.includes("modern"));
  assert.equal(defaultName, "modern");
  assert.deepEqual(templates.filter((t) => t.isDefault).map((t) => t.name), ["modern"]);
  for (const t of templates) assert.ok(t.displayName, `${t.name} has a display name`);
});

test("with no profile, or a profile naming a template that does not exist, the default is standard", async () => {
  for (const text of [null, "cv:\n  template: no-such-template\n", "name: x\n"]) {
    const { defaultName, templates } = await listCvTemplates(CORE, { profilePath: scratchProfile(text) });
    assert.equal(defaultName, "standard", JSON.stringify(text));
    assert.deepEqual(templates.filter((t) => t.isDefault).map((t) => t.name), ["standard"]);
  }
});

test("setting the default edits one line and keeps the profile's comments", () => {
  const source = "# my profile\nname: A\ncv:\n  template: standard # base\n  other: 1\n";

  const text = profileWithCvTemplate(source, "modern");

  assert.equal(text, "# my profile\nname: A\ncv:\n  template: \"modern\" # base\n  other: 1\n");
});

test("setting the default creates the cv section when the profile has none", () => {
  const text = profileWithCvTemplate("# top\nname: A\n", "modern");

  assert.match(text, /^# top\nname: A\n/);
  assert.match(text, /cv:\n {2}template: "modern"/);
});

test("a profile that is not a mapping is refused, never rewritten", () => {
  assert.throws(() => profileWithCvTemplate("- a\n- b\n", "modern"), /not a mapping/i);
  assert.throws(() => profileWithCvTemplate("cv: 3\n", "modern"), /cv/i);
});

test("only a template the resolver lists and accepts can become the default", async () => {
  await assert.doesNotReject(assertSelectableTemplate(CORE, "modern"));
  await assert.rejects(assertSelectableTemplate(CORE, "no-such-template"), /not found|unknown/i);
  await assert.rejects(assertSelectableTemplate(CORE, "../../etc/passwd"), /not found|unknown/i);
});

test("every shipped CV template previews as a filled page with the fictional resume", async () => {
  const { templates } = await listCvTemplates(CORE, { profilePath: scratchProfile(null) });
  assert.ok(templates.length >= 2);

  for (const t of templates) {
    const html = await renderTemplatePreview(CORE, t.name);
    assert.ok(html.includes(SAMPLE_CV_PAYLOAD.candidate.name), `${t.name} shows the sample name`);
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), `${t.name} has no unfilled placeholder`);
  }
});

test("the fictional resume carries only reserved example contact details", () => {
  const { candidate } = SAMPLE_CV_PAYLOAD;
  assert.match(candidate.email, /@example\.com$/);
  assert.equal(candidate.linkedin, undefined);
  assert.equal(candidate.github, undefined);
  assert.equal(candidate.portfolio, undefined);
});

test("a flow-style cv mapping with comments is refused, not rewritten without them", () => {
  const source = "# my profile\ncv: { template: standard } # base\n";

  assert.throws(() => profileWithCvTemplate(source, "modern"), /comment/i);
});

test("a flow-style cv mapping with no comments is still written", () => {
  const text = profileWithCvTemplate("name: A\ncv: { template: standard }\n", "modern");

  assert.match(text, /template: modern/);
});

test("the preview page carries its own CSP so it holds when loaded as srcdoc", () => {
  const out = withPreviewCsp("<!DOCTYPE html><html><head><title>x</title></head><body>b</body></html>");

  assert.match(out, /<head><meta http-equiv="Content-Security-Policy" content="[^"]*img-src data:[^"]*">/);
  assert.ok(out.includes("<title>x</title>"));
});

test("a page with no head still gets the CSP", () => {
  assert.match(withPreviewCsp("<p>hi</p>"), /^<meta http-equiv="Content-Security-Policy"/);
});

test("a comment with no space after the # still blocks a comment-dropping rewrite", () => {
  assert.throws(() => profileWithCvTemplate("cv: { template: standard } #base\n", "modern"), /comment/i);
});

test("a # inside a value is not mistaken for a comment", () => {
  const text = profileWithCvTemplate("name: a#b\ncv: { template: standard }\n", "modern");

  assert.match(text, /template: modern/);
});

test("the CSP goes after the real head, not a <head> inside a comment", () => {
  const out = withPreviewCsp("<!-- <head> --><html><head><title>x</title></head></html>");

  assert.ok(out.startsWith("<!-- <head> --><html><head><meta http-equiv="));
});

test("a <header> element is not mistaken for the head", () => {
  const out = withPreviewCsp("<html><body><header>h</header></body></html>");

  assert.ok(out.startsWith("<meta http-equiv="));
});
