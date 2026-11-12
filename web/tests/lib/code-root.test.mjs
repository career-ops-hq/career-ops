import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
import { resolveCodeRoot, resolveRootScript } from "../../src/lib/core/code-root.mjs";

const CORE = path.resolve(import.meta.dirname, "../../..");

test("CAREER_OPS_CODE_ROOT (absolute) wins over the cwd fallback", () => {
  const checkout = path.resolve(CORE, "..");
  assert.equal(resolveCodeRoot(checkout, { CAREER_OPS_CODE_ROOT: CORE }), CORE);
});

test("relative CAREER_OPS_CODE_ROOT resolves against the injected cwd", () => {
  // Not this process's cwd: `npm test` runs from web/, where resolving against
  // process.cwd() gives the same answer and would hide the wrong base.
  const web = path.join(os.tmpdir(), "code-root-cwd", "web");
  assert.notEqual(web, process.cwd());
  assert.equal(
    resolveCodeRoot(web, { CAREER_OPS_CODE_ROOT: "../engine" }),
    path.join(os.tmpdir(), "code-root-cwd", "engine"),
  );
});

test("no env → the cwd's parent is the checkout (web/ lives inside it)", () => {
  const web = path.join(CORE, "web");
  assert.equal(resolveCodeRoot(web, {}), CORE);
});

test("the data root is never consulted — scripts never resolve into it (#524)", () => {
  const dataRoot = path.join(CORE, "..", "career-data");
  const codeRoot = resolveCodeRoot(dataRoot, {});
  assert.notEqual(codeRoot, dataRoot);
});

test("resolveRootScript assembles <codeRoot>/<name>.mjs", () => {
  assert.equal(resolveRootScript("/engine", "doctor"), path.join("/engine", "doctor.mjs"));
  assert.equal(resolveRootScript("/engine", "scan-ats-full"), path.join("/engine", "scan-ats-full.mjs"));
});

test("blank CAREER_OPS_CODE_ROOT falls back like an unset var", () => {
  const web = path.join(CORE, "web");
  assert.equal(resolveCodeRoot(web, { CAREER_OPS_CODE_ROOT: "  " }), CORE);
});

// ── rootScript(), the composition the routes call ────────────────────────────
//
// The helpers above kept passing while rootScript() joined their absolute result
// onto the checkout again (`<checkout>/<checkout>/doctor.mjs`), so it is tested
// here as a route runs it: real process.cwd() and process.env. It lives in
// career-ops.ts, reached through the shared @/ alias hook.
const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const { rootScript } = skipTs ? {} : await import("@/lib/career-ops");

function tmpdir(prefix) {
  // realpath: macOS symlinks /var → /private/var, and process.cwd() reports the
  // resolved spelling after chdir.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A checkout holding web/ and one root script, the layout rootScript() expects. */
function fakeCheckout() {
  const root = tmpdir("code-root-checkout-");
  fs.mkdirSync(path.join(root, "web"));
  fs.writeFileSync(path.join(root, "doctor.mjs"), "");
  return root;
}

/** rootScript("doctor") as a route calls it: from `cwd`, with only `env` set. */
function rootScriptFrom(cwd, env) {
  const keys = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const priorCwd = process.cwd();
  process.chdir(cwd);
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return rootScript("doctor");
  } finally {
    process.chdir(priorCwd);
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("rootScript: by default the checkout web/ lives in, even with CAREER_OPS_ROOT on a data-only dir", { skip: skipTs }, () => {
  const checkout = fakeCheckout();
  const dataOnly = tmpdir("code-root-data-");
  assert.equal(rootScriptFrom(path.join(checkout, "web"), { CAREER_OPS_ROOT: dataOnly }), path.join(checkout, "doctor.mjs"));
});

test("rootScript: the absolute script path is returned once, not joined onto the checkout again", { skip: skipTs }, () => {
  const checkout = fakeCheckout();
  const script = rootScriptFrom(path.join(checkout, "web"), {});
  assert.ok(path.isAbsolute(script), script);
  // The check the doctor route makes before it spawns anything.
  assert.ok(fs.existsSync(script), `expected an existing script, got ${script}`);
});

test("rootScript: CAREER_OPS_CODE_ROOT overrides the checkout", { skip: skipTs }, () => {
  const checkout = fakeCheckout();
  const engine = fakeCheckout();
  assert.equal(rootScriptFrom(path.join(checkout, "web"), { CAREER_OPS_CODE_ROOT: engine }), path.join(engine, "doctor.mjs"));
});
