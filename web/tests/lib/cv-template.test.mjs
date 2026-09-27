// The dashboard and the CLI must fill the SAME CV template (#4034).
//
// The half that is easy to get wrong is not the lookup — that is delegated to the
// core's cv-templates.mjs — but the BASE a relative path resolves against.
// cv-templates.mjs reads CAREER_OPS_PROFILE relative to the cwd, and the cwd is
// `<core>` for the CLI and `<core>/web` for the dashboard. `config/profile.yml`
// therefore names two different files, one of which does not exist: the dashboard
// finds no profile, falls back to the base template, and the two agree on nothing
// while reporting no error. Same class of bug, same fix, as data-root.test.mjs.
//
// Every case runs against a REAL temporary checkout holding the real
// cv-templates.mjs, and drives the REAL `process.env` and `process.cwd()` rather
// than injected stand-ins. That is not ceremony: an injected env made the relative
// case pass against the UNFIXED code, because cv-templates.mjs reads
// `process.env.CAREER_OPS_PROFILE` itself, at module load, and never saw the
// stand-in. The test agreed with the bug.
//
// Run:  node --test tests/lib/cv-template.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCvTemplate } from "../../src/lib/core/cv-template.mjs";
import { BASE_CV_TEMPLATE, buildPrompt } from "../../src/lib/run-prompts.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// cv-templates.mjs imports js-yaml. A web-only install (web-ci.yml runs `npm ci`
// in web/ alone) has the file and not its dependencies, so probe importability
// rather than existence — existsSync would call that runnable and every case
// below would fail on ERR_MODULE_NOT_FOUND instead of skipping (mirrors
// followups-lock.test.mjs / #2922).
let coreUsable = true;
try {
  await import(path.join(CORE, "cv-templates.mjs"));
} catch {
  coreUsable = false;
}

/**
 * A throwaway career-ops checkout: the real cv-templates.mjs, a base template, a
 * named one, and a profile.yml selecting the named one. Each call gets its own
 * directory, which also gives cv-templates.mjs a fresh module URL — it caches its
 * default profile path at load, so a shared copy would freeze the first case's env.
 */
function fakeCheckout({ profileAt = "config/profile.yml", template = "mine", pack = null } = {}) {
  // realpath: macOS symlinks /var → /private/var, and path.relative() against an
  // unresolved base would compare two spellings of the same directory.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cv-template-")));
  fs.copyFileSync(path.join(CORE, "cv-templates.mjs"), path.join(root, "cv-templates.mjs"));
  // cv-templates.mjs imports ./lib/is-main-module.mjs relative to itself.
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(CORE, "lib", "is-main-module.mjs"),
    path.join(root, "lib", "is-main-module.mjs"),
  );
  // js-yaml is a bare specifier: outside the checkout there is no node_modules on
  // the way up, the import throws, and EVERY case below would fall back to the
  // base template — i.e. pass for the reason the fix exists to remove.
  fs.symlinkSync(path.join(CORE, "node_modules"), path.join(root, "node_modules"), "dir");
  // Every template must carry the placeholders validateTemplate() requires, or
  // resolveTemplate throws and the fallback would hide which case we are in.
  const body = "{{NAME}}{{EXPERIENCE}}{{EDUCATION}}";
  fs.mkdirSync(path.join(root, "templates"), { recursive: true });
  fs.writeFileSync(path.join(root, "templates", "cv-template.html"), body);
  // One home for the named template, never both: discover() throws on a name two
  // files claim, which would fail every case for an unrelated reason.
  const home = pack ? path.join(root, "templates", pack) : path.join(root, "templates");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, `cv-template.${template}.html`), body);
  const profile = path.resolve(root, profileAt);
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.writeFileSync(profile, `cv:\n  template: ${template}\n`);
  return root;
}

/** Run `fn` as the dashboard does: cwd `<root>/web`, with this CAREER_OPS_PROFILE. */
async function asDashboard(root, profileEnv, fn) {
  const priorCwd = process.cwd();
  const priorEnv = process.env.CAREER_OPS_PROFILE;
  fs.mkdirSync(path.join(root, "web"), { recursive: true });
  process.chdir(path.join(root, "web"));
  if (profileEnv === undefined) delete process.env.CAREER_OPS_PROFILE;
  else process.env.CAREER_OPS_PROFILE = profileEnv;
  try {
    return await fn();
  } finally {
    process.chdir(priorCwd);
    if (priorEnv === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = priorEnv;
  }
}

test("a RELATIVE CAREER_OPS_PROFILE resolves against the checkout, not the cwd", { skip: !coreUsable }, async () => {
  // Given a user who points CAREER_OPS_PROFILE at their profile the way the core
  // documents it — relative — and a dashboard whose cwd is `<core>/web`
  const root = fakeCheckout();

  const rel = await asDashboard(root, "config/profile.yml", () => resolveCvTemplate(root));

  // Then cv.template is honored, exactly as it is on the CLI. Resolved against the
  // cwd this reads `<core>/web/config/profile.yml`, finds nothing, and silently
  // returns the base template instead — the CLI and the dashboard disagreeing
  // with no error anywhere.
  assert.equal(rel, "templates/cv-template.mine.html");
});

test("an ABSOLUTE CAREER_OPS_PROFILE is left alone", { skip: !coreUsable }, async () => {
  // Given a profile kept outside the checkout entirely (#524's supported setup),
  // path.resolve must return it unchanged
  const abs = path.join(os.tmpdir(), `cv-template-profile-${process.pid}.yml`);
  const root = fakeCheckout({ profileAt: abs });

  const rel = await asDashboard(root, abs, () => resolveCvTemplate(root));

  assert.equal(rel, "templates/cv-template.mine.html");
  fs.rmSync(abs, { force: true });
});

test("no CAREER_OPS_PROFILE falls back to the checkout's own config/profile.yml", { skip: !coreUsable }, async () => {
  // Given the default install, where the core's own default is the right answer
  // and this module must not restate it
  const root = fakeCheckout();

  const rel = await asDashboard(root, undefined, () => resolveCvTemplate(root));

  assert.equal(rel, "templates/cv-template.mine.html");
});

test("a template pack survives BOTH halves: the resolver and the prompt's guard", { skip: !coreUsable }, async () => {
  // The seam this PR is about. resolveCvTemplate and safeCvTemplate live in
  // different modules and each looked right on its own, while the second silently
  // threw away what the first returned. Nothing pinned them together, so a pack
  // directory with a space resolved correctly and then fell back to the base
  // template one function call later, with no error on either side.
  const root = fakeCheckout({ pack: "My Pack" });

  const rel = await asDashboard(root, undefined, () => resolveCvTemplate(root));
  assert.equal(rel, "templates/My Pack/cv-template.mine.html");

  // And the prompt names the file the resolver actually chose.
  assert.ok(
    buildPrompt({ kind: "pdf", input: "018", memory: "", today: "2026-08-04", cvTemplate: rel }).includes(rel),
    "the resolver's own output must pass run-prompts.mjs's template guard",
  );
});

test("an unresolvable checkout yields the base template rather than throwing", async () => {
  // Given a root with no cv-templates.mjs at all — an older checkout, or a
  // data-only install. A failed run is worse than an untailored CV.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cv-template-empty-")));

  assert.equal(await resolveCvTemplate(root), BASE_CV_TEMPLATE);
});
