// Duplicate, rename and delete of the user's own templates (#1692). Every case
// runs against the REAL core in this checkout and a scratch data/templates
// directory, because "does the copy still resolve" is the whole point and a
// stand-in resolver would only agree with itself.
//
// Run:  node --test tests/lib/template-files.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTemplatesOfKind } from "../../src/lib/template-gallery.mjs";
import {
  duplicateTemplate,
  renameTemplate,
  renameTemplateAndFollow,
  deleteTemplate,
  isValidTemplateName,
} from "../../src/lib/template-files.mjs";
import { TemplateRefusal, refusalFrom } from "../../src/lib/template-refusal.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-files-"));
  const userDir = path.join(root, "data", "templates");
  const profilePath = path.join(root, "profile.yml");
  return { root, userDir, profilePath };
}

const names = async (s, kind = "cv") =>
  (await listTemplatesOfKind(CORE, kind, { profilePath: s.profilePath, userDir: s.userDir })).templates;

test("template names are lowercase words joined by single hyphens, and never the base", () => {
  for (const ok of ["mine", "my-cv", "v2", "a1-b2"]) assert.ok(isValidTemplateName(ok), ok);
  for (const bad of ["", "Mine", "my cv", "a--b", "-a", "a-", "../x", "a/b", "a.b", "standard", "x".repeat(41)]) {
    assert.ok(!isValidTemplateName(bad), JSON.stringify(bad));
  }
});

test("duplicating a shipped template writes a user copy that lists and resolves", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "my-modern", userDir: s.userDir });

  const mine = (await names(s)).find((t) => t.name === "my-modern");
  assert.equal(mine?.layer, "user");
  assert.ok(fs.existsSync(path.join(s.userDir, "cv-template.my-modern.html")));
});

test("duplicating a pack carries its sections, so the copy still resolves", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cv", from: "ats", name: "my-ats", userDir: s.userDir });

  assert.ok(fs.existsSync(path.join(s.userDir, "my-ats", "cv-template.my-ats.html")));
  assert.ok(fs.existsSync(path.join(s.userDir, "my-ats", "sections", "experience.html")));
  assert.equal((await names(s)).find((t) => t.name === "my-ats")?.layer, "user");
});

test("a duplicate of a flat template that declares sections is refused loudly, not left broken", async () => {
  const s = scratch();
  fs.mkdirSync(s.userDir, { recursive: true });
  fs.writeFileSync(
    path.join(s.userDir, "cv-template.declares.html"),
    "<!-- career-ops-template\nname: D\nsections: all\n-->{{NAME}}{{EXPERIENCE}}{{EDUCATION}}",
  );

  await assert.rejects(
    duplicateTemplate(CORE, { kind: "cv", from: "declares", name: "copy-of-it", userDir: s.userDir }),
    /sections/i,
  );
  assert.ok(!fs.existsSync(path.join(s.userDir, "cv-template.copy-of-it.html")));
});

test("a cover-letter template can be duplicated too", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cover", from: "standard", name: "warm", userDir: s.userDir });

  assert.ok(fs.existsSync(path.join(s.userDir, "cover-letter-template.warm.html")));
  assert.equal((await names(s, "cover")).find((t) => t.name === "warm")?.layer, "user");
});

test("duplicate refuses a bad name, an existing name, and an unknown source", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "taken", userDir: s.userDir });

  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "../x", userDir: s.userDir }), /name/i);
  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "taken", userDir: s.userDir }), /already/i);
  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "compact", userDir: s.userDir }), /already/i);
  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "nope", name: "fresh", userDir: s.userDir }), /not found/i);
});

test("renaming a user template moves its file and keeps it resolvable", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "before", userDir: s.userDir });

  await renameTemplate(CORE, { kind: "cv", name: "before", to: "after", userDir: s.userDir, profilePath: s.profilePath });

  const listed = (await names(s)).map((t) => t.name);
  assert.ok(listed.includes("after") && !listed.includes("before"));
});

test("a shipped template cannot be renamed, and a rename cannot land on an existing name", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "mine", userDir: s.userDir });

  await assert.rejects(renameTemplate(CORE, { kind: "cv", name: "compact", to: "x1", userDir: s.userDir, profilePath: s.profilePath }), /your own|user/i);
  await assert.rejects(renameTemplate(CORE, { kind: "cv", name: "mine", to: "compact", userDir: s.userDir, profilePath: s.profilePath }), /already/i);
});

test("deleting a user template removes it, and a pack's directory goes with its only template", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "flat-one", userDir: s.userDir });
  await duplicateTemplate(CORE, { kind: "cv", from: "ats", name: "pack-one", userDir: s.userDir });

  await deleteTemplate(CORE, { kind: "cv", name: "flat-one", userDir: s.userDir, profilePath: s.profilePath });
  await deleteTemplate(CORE, { kind: "cv", name: "pack-one", userDir: s.userDir, profilePath: s.profilePath });

  assert.ok(!fs.existsSync(path.join(s.userDir, "cv-template.flat-one.html")));
  assert.ok(!fs.existsSync(path.join(s.userDir, "pack-one")));
  assert.ok(!(await names(s)).some((t) => ["flat-one", "pack-one"].includes(t.name)));
});

test("a shipped template cannot be deleted", async () => {
  const s = scratch();

  await assert.rejects(deleteTemplate(CORE, { kind: "cv", name: "modern", userDir: s.userDir, profilePath: s.profilePath }), /your own|user/i);
});

test("the template the profile names as default cannot be deleted", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "favorite", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: favorite\n");

  await assert.rejects(deleteTemplate(CORE, { kind: "cv", name: "favorite", userDir: s.userDir, profilePath: s.profilePath }), /default/i);
  assert.ok(fs.existsSync(path.join(s.userDir, "cv-template.favorite.html")));
});

test("a duplicate's card is not named like its source", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "my-modern", userDir: s.userDir });

  const t = await names(s);
  assert.equal(t.find((x) => x.name === "modern").displayName, "Modern");
  assert.equal(t.find((x) => x.name === "my-modern").displayName, "My Modern");
});

test("renaming the default reports it, so the profile can follow", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "was-default", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: was-default\n");

  const out = await renameTemplate(CORE, { kind: "cv", name: "was-default", to: "now-default", userDir: s.userDir, profilePath: s.profilePath });

  assert.deepEqual(out, { wasDefault: true });
});

test("duplicating a pack never removes a folder that was already there under the new name", async () => {
  const s = scratch();
  // A user folder that happens to carry the name, holding something else.
  fs.mkdirSync(path.join(s.userDir, "my-ats"), { recursive: true });
  fs.writeFileSync(path.join(s.userDir, "my-ats", "notes.txt"), "keep me");

  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "ats", name: "my-ats", userDir: s.userDir }), /folder|already/i);

  assert.equal(fs.readFileSync(path.join(s.userDir, "my-ats", "notes.txt"), "utf8"), "keep me");
});

test("caller-correctable refusals are typed, with the status they deserve", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "fav", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: fav\n");
  const refusal = async (p) => p.then(() => assert.fail("expected a refusal"), (e) => e);

  const badName = await refusal(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "Bad Name", userDir: s.userDir }));
  const missing = await refusal(duplicateTemplate(CORE, { kind: "cv", from: "nope", name: "fresh", userDir: s.userDir }));
  const taken = await refusal(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "fav", userDir: s.userDir }));
  const shipped = await refusal(deleteTemplate(CORE, { kind: "cv", name: "modern", userDir: s.userDir, profilePath: s.profilePath }));
  const isDefault = await refusal(deleteTemplate(CORE, { kind: "cv", name: "fav", userDir: s.userDir, profilePath: s.profilePath }));

  for (const e of [badName, missing, taken, shipped, isDefault]) assert.ok(e instanceof TemplateRefusal, e.message);
  assert.equal(missing.status, 404);
  assert.deepEqual([badName, taken, shipped, isDefault].map((e) => e.status), [422, 422, 422, 422]);
});

test("an operating-system failure is not a refusal", async () => {
  const s = scratch();
  fs.mkdirSync(path.dirname(s.userDir), { recursive: true });
  fs.writeFileSync(s.userDir, "a file where the templates folder should be");

  const err = await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "mine", userDir: s.userDir }).then(() => null, (e) => e);

  assert.ok(err);
  assert.ok(!(err instanceof TemplateRefusal));
});

test("only validation errors become refusals; an operating-system error passes through untouched", () => {
  const validation = new Error("Template x missing required placeholders: {{NAME}}");
  const os = Object.assign(new Error("ENOENT: no such file or directory, open '/home/someone/data/templates/x'"), { code: "ENOENT", syscall: "open" });

  assert.ok(refusalFrom(validation) instanceof TemplateRefusal);
  assert.equal(refusalFrom(os), os);
});

test("renaming a template and renaming it back restores the original file exactly", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "first", userDir: s.userDir });
  const before = fs.readFileSync(path.join(s.userDir, "cv-template.first.html"), "utf8");

  await renameTemplate(CORE, { kind: "cv", name: "first", to: "second", userDir: s.userDir, profilePath: s.profilePath });
  await renameTemplate(CORE, { kind: "cv", name: "second", to: "first", userDir: s.userDir, profilePath: s.profilePath });

  assert.equal(fs.readFileSync(path.join(s.userDir, "cv-template.first.html"), "utf8"), before);
  assert.ok(!fs.existsSync(path.join(s.userDir, "cv-template.second.html")));
});

test("when the profile update fails, a renamed default is put back and the failure is a 409 refusal", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "favorite", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: favorite\n");
  const before = fs.readFileSync(path.join(s.userDir, "cv-template.favorite.html"), "utf8");
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error("EACCES: permission denied, open '/home/someone/config/profile.yml'");
  };

  const err = await renameTemplateAndFollow(CORE, { kind: "cv", name: "favorite", to: "renamed", userDir: s.userDir, profilePath: s.profilePath }, failing)
    .then(() => null, (e) => e);

  assert.equal(calls, 1);
  assert.ok(err instanceof TemplateRefusal);
  assert.equal(err.status, 409);
  assert.match(err.message, /Nothing was renamed/);
  assert.ok(!/someone/.test(err.message), "the operating-system message is not returned");
  assert.match(err.cause.message, /EACCES/);
  assert.equal(fs.readFileSync(path.join(s.userDir, "cv-template.favorite.html"), "utf8"), before);
  assert.ok(!fs.existsSync(path.join(s.userDir, "cv-template.renamed.html")));
});

test("a rename of a template that is not the default never touches the profile", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "plain", userDir: s.userDir });
  let calls = 0;

  const out = await renameTemplateAndFollow(CORE, { kind: "cv", name: "plain", to: "plainer", userDir: s.userDir, profilePath: s.profilePath }, async () => { calls += 1; });

  assert.deepEqual(out, { wasDefault: false });
  assert.equal(calls, 0);
});

test("a successful rename of the default runs the profile update once", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "fav", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: fav\n");
  let calls = 0;

  const out = await renameTemplateAndFollow(CORE, { kind: "cv", name: "fav", to: "fav2", userDir: s.userDir, profilePath: s.profilePath }, async () => { calls += 1; });

  assert.deepEqual(out, { wasDefault: true });
  assert.equal(calls, 1);
  assert.ok(fs.existsSync(path.join(s.userDir, "cv-template.fav2.html")));
});
