import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

// Core CI installs root dependencies only. Use the real route handlers and
// filesystem and supply just the framework's JSON response adapter.
const adapter = "data:text/javascript,export const NextResponse = Response;";
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: ${JSON.stringify(adapter)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST: saveCv } = await import("../../src/app/api/cv/route.ts");
const { POST: saveProfile } = await import("../../src/app/api/profile/route.ts");
const { POST: saveCadence } = await import("../../src/app/api/followups/cadence/route.ts");

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "web-user-file-link-"));
  const root = path.join(folder, "workspace");
  fs.mkdirSync(root);
  const previousRoot = process.env.CAREER_OPS_ROOT;
  const previousProfile = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_PROFILE;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    if (previousProfile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = previousProfile;
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { folder, root };
}

function link(t, target, alias) {
  try {
    fs.symlinkSync(target, alias, "file");
    return true;
  } catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    t.skip("symlink creation requires Windows Developer Mode or elevation");
    return false;
  }
}

function request(route, body) {
  return new Request(`http://fixture.invalid/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("saving a CV updates the shared file without replacing its link", async (t) => {
  const { folder, root } = fixture(t);
  const alias = path.join(root, "cv.md");
  const target = path.join(folder, "shared-cv.md");
  const original = "# Fictional candidate\n";
  fs.writeFileSync(target, original);
  if (!link(t, target, alias)) return;

  const updated = original + "\n## Skills\n- Research\n";
  const saved = await saveCv(request("cv", {
    content: updated, expected: { exists: true, content: original },
  }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, backedUp: true });
  assert.ok(fs.lstatSync(alias).isSymbolicLink(), "save replaced the shared CV link");
  assert.equal(fs.readFileSync(target, "utf8"), updated);
  const backups = fs.readdirSync(folder).filter((name) => name.startsWith("shared-cv.md.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(folder, backups[0]), "utf8"), original);

  const autosaved = updated + "- Testing\n";
  const reply = await saveCv(request("cv", {
    backup: false, content: autosaved, expected: { exists: true, content: updated },
  }));
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { ok: true, backedUp: false });
  assert.ok(fs.lstatSync(alias).isSymbolicLink());
  assert.equal(fs.readFileSync(target, "utf8"), autosaved);
});

test("saving a selected profile preserves the link and updates the shared configuration", async (t) => {
  const { folder, root } = fixture(t);
  fs.mkdirSync(path.join(root, "config"));
  const defaultProfile = path.join(root, "config", "profile.yml");
  const alias = path.join(root, "active.yml");
  const target = path.join(folder, "shared-profile.yml");
  const original = "# shared settings\ncandidate:\n  full_name: Original Candidate\nlanguage:\n  output: de\n";
  fs.writeFileSync(defaultProfile, "candidate:\n  full_name: Default Candidate\n");
  fs.writeFileSync(target, original);
  if (!link(t, target, alias)) return;
  process.env.CAREER_OPS_PROFILE = "active.yml";

  const reply = await saveProfile(request("profile", { name: "Edited Candidate" }));
  assert.equal(reply.status, 200);
  assert.ok(fs.lstatSync(alias).isSymbolicLink(), "save replaced the selected profile link");
  assert.equal(fs.readFileSync(target, "utf8"), original.replace("Original Candidate", '"Edited Candidate"'));
  const cadence = await saveCadence(request("followups/cadence", { applied_first_days: 9 }));
  assert.equal(cadence.status, 200);
  assert.ok(fs.lstatSync(alias).isSymbolicLink());
  assert.match(fs.readFileSync(target, "utf8"), /applied_first_days: 9/);
  assert.match(fs.readFileSync(defaultProfile, "utf8"), /Default Candidate/);
});

test("a first CV save through a dangling file link creates its target", async (t) => {
  const { folder, root } = fixture(t);
  const alias = path.join(root, "cv.md");
  const target = path.join(folder, "future-cv.md");
  if (!link(t, path.relative(root, target), alias)) return;
  const created = "# Fictional candidate\n";
  const reply = await saveCv(request("cv", {
    content: created, expected: { exists: false, content: "" },
  }));
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { ok: true, backedUp: false });
  assert.ok(fs.lstatSync(alias).isSymbolicLink(), "first save replaced the CV link");
  assert.equal(fs.readFileSync(target, "utf8"), created);
});
