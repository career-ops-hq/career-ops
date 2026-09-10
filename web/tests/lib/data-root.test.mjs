import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDataRoot } from "../../src/lib/core/data-root.mjs";

const CORE = path.resolve(import.meta.dirname, "../../..");

/** resolveDataRoot wired to a real directory, like careerOpsRoot() wires it. */
function resolve(coreRoot, env = {}) {
  const readMarker = (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  return resolveDataRoot(coreRoot, readMarker, env, path.resolve, path.join);
}

function tmpdir() {
  // realpath: macOS symlinks /var → /private/var, and an unresolved base makes
  // every assertion below compare two spellings of the same directory.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "data-root-")));
}

test("no env, no marker → the core root itself", () => {
  const core = tmpdir();
  assert.equal(resolve(core), core);
});

test("CAREER_OPS_ROOT (absolute) wins and is returned unchanged", () => {
  const core = tmpdir();
  const other = tmpdir();
  assert.equal(resolve(core, { CAREER_OPS_ROOT: other }), other);
});

test("CAREER_OPS_DATA_DIR is honored — the variable web/ previously ignored", () => {
  const core = tmpdir();
  const other = tmpdir();
  assert.equal(resolve(core, { CAREER_OPS_DATA_DIR: other }), other);
});

test("CAREER_OPS_ROOT beats CAREER_OPS_DATA_DIR when both are set", () => {
  const core = tmpdir();
  const win = tmpdir();
  const lose = tmpdir();
  assert.equal(resolve(core, { CAREER_OPS_ROOT: win, CAREER_OPS_DATA_DIR: lose }), win);
});

test(".career-ops-data marker is honored — the file web/ previously ignored", () => {
  const core = tmpdir();
  const data = tmpdir();
  fs.writeFileSync(path.join(core, ".career-ops-data"), data);
  assert.equal(resolve(core), data);
});

test("env beats the marker", () => {
  const core = tmpdir();
  const viaMarker = tmpdir();
  const viaEnv = tmpdir();
  fs.writeFileSync(path.join(core, ".career-ops-data"), viaMarker);
  assert.equal(resolve(core, { CAREER_OPS_ROOT: viaEnv }), viaEnv);
});

test("an empty marker falls through to the core root, never resolving to it by accident", () => {
  const core = tmpdir();
  fs.writeFileSync(path.join(core, ".career-ops-data"), "   \n");
  assert.equal(resolve(core), core);
});

test("a trailing newline in the marker is trimmed (editors add one)", () => {
  const core = tmpdir();
  const data = tmpdir();
  fs.writeFileSync(path.join(core, ".career-ops-data"), `${data}\n`);
  assert.equal(resolve(core), data);
});

// ── the regression this module exists for ────────────────────────────────────

test("RELATIVE values resolve against the CORE root, not web/", () => {
  const core = tmpdir();
  fs.mkdirSync(path.join(core, "web"), { recursive: true });
  fs.writeFileSync(path.join(core, ".career-ops-data"), "./shared-data");

  // The bug: resolving against process.cwd() (= <core>/web) yields
  // <core>/web/shared-data. The core yields <core>/shared-data.
  assert.equal(resolve(core), path.join(core, "shared-data"));
  assert.notEqual(resolve(core), path.join(core, "web", "shared-data"));
});

test("a dot-dot relative marker escapes the checkout, as the core intends", () => {
  const core = tmpdir();
  fs.writeFileSync(path.join(core, ".career-ops-data"), "../sibling-data");
  assert.equal(resolve(core), path.resolve(core, "../sibling-data"));
});

// ── agreement with the core (the point of the whole module) ──────────────────

test("AGREES with the core's path-resolver.mjs on every branch", async (t) => {
  const src = path.join(CORE, "path-resolver.mjs");
  if (!fs.existsSync(src)) return t.skip("core path-resolver.mjs not present");

  // The core resolver derives __dirname from import.meta.url, so it reads the
  // directory it is LOADED FROM. Copying it into a fixture is the pattern its
  // own header prescribes ("test fixtures copy this file standalone").
  const cases = [
    { name: "no env, no marker", marker: null, env: {} },
    { name: "absolute marker", marker: "ABS", env: {} },
    { name: "relative marker", marker: "./shared-data", env: {} },
    { name: "dot-dot marker", marker: "../sibling-data", env: {} },
    { name: "empty marker", marker: "  \n", env: {} },
    { name: "CAREER_OPS_ROOT absolute", marker: null, env: { CAREER_OPS_ROOT: "ABS" } },
    { name: "CAREER_OPS_ROOT relative", marker: null, env: { CAREER_OPS_ROOT: "./from-env" } },
    { name: "CAREER_OPS_DATA_DIR relative", marker: null, env: { CAREER_OPS_DATA_DIR: "./from-data-dir" } },
    { name: "both env vars set", marker: null, env: { CAREER_OPS_ROOT: "./win", CAREER_OPS_DATA_DIR: "./lose" } },
    { name: "env overrides marker", marker: "./from-marker", env: { CAREER_OPS_ROOT: "./from-env" } },
  ];

  for (const c of cases) {
    const core = tmpdir();
    const abs = tmpdir();
    const subst = (v) => (v === "ABS" ? abs : v);

    fs.copyFileSync(src, path.join(core, "path-resolver.mjs"));
    if (c.marker !== null) fs.writeFileSync(path.join(core, ".career-ops-data"), subst(c.marker));

    const env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, subst(v)]));

    const saved = { ...process.env };
    delete process.env.CAREER_OPS_ROOT;
    delete process.env.CAREER_OPS_DATA_DIR;
    Object.assign(process.env, env);

    let core_answer;
    try {
      // cache-bust: each fixture is a distinct module instance
      const mod = await import(`${pathToFileURL(path.join(core, "path-resolver.mjs")).href}?c=${encodeURIComponent(c.name)}`);
      core_answer = mod.getCareerOpsRoot();
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, saved);
    }

    const web_answer = resolve(core, env);
    assert.equal(web_answer, core_answer, `disagreement on: ${c.name}`);
  }
});
