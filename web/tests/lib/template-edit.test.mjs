// Editing the body of one of the user's own templates (#1692). The checks run the
// REAL core resolver against a scratch data/templates directory: a save is
// accepted only when the result still resolves, and refused (with nothing written)
// when it does not.
//
// Run:  node --test tests/lib/template-edit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { duplicateTemplate } from "../../src/lib/template-files.mjs";
import { TemplateRefusal } from "../../src/lib/template-refusal.mjs";
import { readUserTemplate, checkTemplateEdit, assertVersionUnchanged, MAX_TEMPLATE_BYTES } from "../../src/lib/template-edit.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function withCopy(from = "modern", name = "mine", kind = "cv") {
  const userDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "template-edit-")), "data", "templates");
  await duplicateTemplate(CORE, { kind, from, name, userDir });
  return userDir;
}

test("reading a user template returns its text and a version that changes with the text", async () => {
  const userDir = await withCopy();

  const a = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });
  fs.appendFileSync(path.join(userDir, "cv-template.mine.html"), "\n<!-- edited -->\n");
  const b = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });

  assert.ok(a.text.includes("{{NAME}}"));
  assert.notEqual(a.version, b.version);
});

test("a shipped template cannot be opened for editing", async () => {
  const userDir = await withCopy();

  await assert.rejects(readUserTemplate(CORE, { kind: "cv", name: "compact", userDir }), /your own|user/i);
});

test("an edit that keeps the required placeholders is accepted and reports where to write", async () => {
  const userDir = await withCopy();
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });

  const out = await checkTemplateEdit(CORE, { kind: "cv", name: "mine", text: text.replace("</title>", " edited</title>"), version, userDir });

  assert.equal(out.path, path.join(userDir, "cv-template.mine.html"));
});

test("an edit that drops a required placeholder is refused, naming it", async () => {
  const userDir = await withCopy();
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });

  await assert.rejects(
    checkTemplateEdit(CORE, { kind: "cv", name: "mine", text: text.replaceAll("{{EXPERIENCE}}", ""), version, userDir }),
    /EXPERIENCE/,
  );
});

test("a pack template is checked with its own sections beside it", async () => {
  const userDir = await withCopy("ats", "my-ats");
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "my-ats", userDir });

  await assert.doesNotReject(checkTemplateEdit(CORE, { kind: "cv", name: "my-ats", text, version, userDir }));
});

test("a stale version is refused, so a newer edit is not overwritten", async () => {
  const userDir = await withCopy();
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });
  fs.appendFileSync(path.join(userDir, "cv-template.mine.html"), "\n<!-- edited elsewhere -->\n");

  await assert.rejects(checkTemplateEdit(CORE, { kind: "cv", name: "mine", text, version, userDir }), /changed/i);
});

test("an oversized body, or one with a NUL byte, is refused", async () => {
  const userDir = await withCopy();
  const { version } = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });

  await assert.rejects(checkTemplateEdit(CORE, { kind: "cv", name: "mine", text: "x".repeat(MAX_TEMPLATE_BYTES + 1), version, userDir }), /too large/i);
  await assert.rejects(checkTemplateEdit(CORE, { kind: "cv", name: "mine", text: "{{NAME}}\0", version, userDir }), /binary|NUL/i);
});

test("a cover-letter template is editable the same way", async () => {
  const userDir = await withCopy("standard", "warm", "cover");
  const { text, version } = await readUserTemplate(CORE, { kind: "cover", name: "warm", userDir });

  await assert.rejects(checkTemplateEdit(CORE, { kind: "cover", name: "warm", text: text.replaceAll("{{OPENING}}", ""), version, userDir }), /OPENING/);
});

test("edit refusals are typed, with the status they deserve", async () => {
  const userDir = await withCopy();
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });
  const refusal = async (p) => p.then(() => assert.fail("expected a refusal"), (e) => e);

  const shipped = await refusal(readUserTemplate(CORE, { kind: "cv", name: "compact", userDir }));
  const missing = await refusal(readUserTemplate(CORE, { kind: "cv", name: "nope", userDir }));
  const broken = await refusal(checkTemplateEdit(CORE, { kind: "cv", name: "mine", text: text.replaceAll("{{EXPERIENCE}}", ""), version, userDir }));
  const large = await refusal(checkTemplateEdit(CORE, { kind: "cv", name: "mine", text: "x".repeat(MAX_TEMPLATE_BYTES + 1), version, userDir }));
  fs.appendFileSync(path.join(userDir, "cv-template.mine.html"), "\n<!-- moved on -->\n");
  const stale = await refusal(checkTemplateEdit(CORE, { kind: "cv", name: "mine", text, version, userDir }));

  for (const e of [shipped, missing, broken, large, stale]) assert.ok(e instanceof TemplateRefusal, e.message);
  assert.deepEqual([shipped, missing, broken, large, stale].map((e) => e.status), [422, 404, 422, 422, 409]);
});

test("the version is checked again at write time, so a save that lost a race is refused", async () => {
  const userDir = await withCopy();
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "mine", userDir });
  const checked = await checkTemplateEdit(CORE, { kind: "cv", name: "mine", text, version, userDir });

  assert.doesNotThrow(() => assertVersionUnchanged(checked.path, version));
  fs.appendFileSync(checked.path, "\n<!-- written by a faster save -->\n");

  assert.throws(() => assertVersionUnchanged(checked.path, version), (e) => e instanceof TemplateRefusal && e.status === 409);
});

// A save writes through checkTemplateEdit's path, so a template whose folder or
// file really lives outside the user's templates directory (a symlinked pack, or a
// symlinked file) must not be offered for writing. Reading it stays allowed.
function linkedSetup() {
  const userDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "template-edit-link-")), "data", "templates");
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "template-edit-target-"));
  fs.mkdirSync(userDir, { recursive: true });
  return { userDir, target };
}

test("an edit to a template in a symlinked pack folder is refused, though reading it works", async () => {
  const { userDir, target } = linkedSetup();
  const file = path.join(target, "cv-template.linked.html");
  fs.copyFileSync(path.join(CORE, "templates", "cv-template.modern.html"), file);
  fs.symlinkSync(target, path.join(userDir, "linked"), "dir");
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "linked", userDir });
  const before = fs.readFileSync(file, "utf8");

  const err = await checkTemplateEdit(CORE, { kind: "cv", name: "linked", text, version, userDir }).then(() => null, (e) => e);

  assert.ok(err instanceof TemplateRefusal, String(err));
  assert.ok(!err.message.includes(target), "the message names no path");
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("an edit to a template file that is itself a symlink to outside is refused", async () => {
  const { userDir, target } = linkedSetup();
  const file = path.join(target, "real.html");
  fs.copyFileSync(path.join(CORE, "templates", "cv-template.modern.html"), file);
  fs.symlinkSync(file, path.join(userDir, "cv-template.filelink.html"));
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "filelink", userDir });

  const err = await checkTemplateEdit(CORE, { kind: "cv", name: "filelink", text, version, userDir }).then(() => null, (e) => e);

  assert.ok(err instanceof TemplateRefusal, String(err));
});

// The save is an atomic replace (write a temp file, rename it over the path). That
// swaps a symlink for a regular file even when the link points inside the user's
// own directory: the target never receives the edit and the alias stops following
// it. Refuse, as for a link that points outside, rather than write through it.
test("an edit to a template file that is a symlink to another file in the user's directory is refused and leaves link and target alone", async () => {
  const userDir = await withCopy("modern", "realone");
  const real = path.join(userDir, "cv-template.realone.html");
  const link = path.join(userDir, "cv-template.alias.html");
  fs.symlinkSync(real, link);
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "alias", userDir });
  const before = fs.readFileSync(real, "utf8");

  const err = await checkTemplateEdit(CORE, { kind: "cv", name: "alias", text: `${text}\n<!-- edit -->\n`, version, userDir }).then(() => null, (e) => e);

  assert.ok(err instanceof TemplateRefusal, String(err));
  assert.ok(!err.message.includes(userDir), "the message names no path");
  assert.ok(fs.lstatSync(link).isSymbolicLink(), "the link is still a link");
  assert.equal(fs.readFileSync(real, "utf8"), before, "the target is unchanged");
});

test("the real file a link points at can still be edited directly", async () => {
  const userDir = await withCopy("modern", "realone");
  fs.symlinkSync(path.join(userDir, "cv-template.realone.html"), path.join(userDir, "cv-template.alias.html"));
  const { text, version } = await readUserTemplate(CORE, { kind: "cv", name: "realone", userDir });

  const out = await checkTemplateEdit(CORE, { kind: "cv", name: "realone", text: `${text}\n<!-- edit -->\n`, version, userDir });

  assert.equal(out.path, path.join(userDir, "cv-template.realone.html"));
});
