import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDataRoot, unsafeDataRootMessage, UnsafeDataRootError } from "../../src/lib/core/data-root.mjs";

const CORE = path.resolve(import.meta.dirname, "../../..");

/**
 * The plugin-copy check's view of the machine. `env.HOME` stands in for the home
 * directory so a fixture never reads or names the real ~/.claude; with no HOME
 * the real one is used, which no tmpdir fixture lives under.
 */
function hostFor(env) {
  return { homedir: () => env.HOME ?? os.homedir(), realpath: fs.realpathSync, platform: process.platform };
}

/** resolveDataRoot wired to a real directory, like careerOpsRoot() wires it. */
function resolve(coreRoot, env = {}) {
  const readMarker = (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  return resolveDataRoot(coreRoot, readMarker, env, path.resolve, path.join, hostFor(env));
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

// ── Claude Code plugin install copies (#5712) ────────────────────────────────

/**
 * A fixture home holding a plugin install copy at the path Claude Code uses:
 * `<home>/.claude/plugins/<sub>/career-ops/career-ops/1.0.0`.
 */
function pluginLayout(sub = "cache") {
  const home = tmpdir();
  const core = path.join(home, ".claude", "plugins", sub, "career-ops", "career-ops", "1.0.0");
  fs.mkdirSync(core, { recursive: true });
  return { home, core };
}

test("plugin copy, no env, no marker → ~/career-ops-data, never the copy itself", () => {
  const { home, core } = pluginLayout();
  assert.equal(resolve(core, { HOME: home }), path.join(home, "career-ops-data"));
});

for (const sub of ["marketplaces", "synced"]) {
  test(`plugin copy under plugins/${sub}/ also defaults to ~/career-ops-data`, () => {
    const { home, core } = pluginLayout(sub);
    assert.equal(resolve(core, { HOME: home }), path.join(home, "career-ops-data"));
  });
}

test("plugin copy under CLAUDE_CONFIG_DIR is detected without touching HOME", () => {
  const home = tmpdir();
  const config = tmpdir();
  const core = path.join(config, "plugins", "cache", "career-ops", "career-ops", "1.0.0");
  fs.mkdirSync(core, { recursive: true });
  assert.equal(resolve(core, { HOME: home, CLAUDE_CONFIG_DIR: config }), path.join(home, "career-ops-data"));
});

test("plugin copy under CLAUDE_CODE_PLUGIN_CACHE_DIR is detected", () => {
  const home = tmpdir();
  const pluginsRoot = tmpdir();
  const core = path.join(pluginsRoot, "cache", "career-ops", "career-ops", "1.0.0");
  fs.mkdirSync(core, { recursive: true });
  assert.equal(resolve(core, { HOME: home, CLAUDE_CODE_PLUGIN_CACHE_DIR: pluginsRoot }), path.join(home, "career-ops-data"));
});

test("the plugins root itself and its other folders are not a copy", () => {
  const home = tmpdir();
  for (const dir of [path.join(home, ".claude", "plugins", "data", "x"), path.join(home, ".claude", "plugins", "cache")]) {
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(resolve(dir, { HOME: home }), dir);
  }
});

test("plugin copy with an env var outside it → the env value", () => {
  const { home, core } = pluginLayout();
  const data = tmpdir();
  assert.equal(resolve(core, { HOME: home, CAREER_OPS_ROOT: data }), data);
});

test("plugin copy with a marker outside it → the marker value", () => {
  const { home, core } = pluginLayout();
  const data = tmpdir();
  fs.writeFileSync(path.join(core, ".career-ops-data"), data);
  assert.equal(resolve(core, { HOME: home }), data);
});

for (const name of ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR"]) {
  test(`${name} inside a plugin copy is refused, naming the variable`, () => {
    const { home, core } = pluginLayout();
    const inside = path.join(core, "data-root");
    assert.throws(
      () => resolve(tmpdir(), { HOME: home, [name]: inside }),
      (err) => err instanceof UnsafeDataRootError
        && err.code === "CAREER_OPS_UNSAFE_DATA_ROOT"
        && err.source === name
        && err.root === inside
        && err.message.includes(path.join(home, "career-ops-data")),
    );
  });
}

/** A symlink to `target` in a fresh tmpdir, or null where symlinks need privileges. */
function linkTo(target) {
  const link = path.join(tmpdir(), "link-to-copy");
  try {
    fs.symlinkSync(target, link, "dir");
    return link;
  } catch {
    return null;
  }
}

// #7026: realpath fails on a folder that does not exist yet, and the check used
// to fall back to the path as written, so a symlink into a plugin copy was
// refused while a new folder under that same symlink was accepted.
test("a data root under a symlink into a plugin copy is refused before it exists", (t) => {
  const { home, core } = pluginLayout();
  const link = linkTo(core);
  if (!link) return t.skip("cannot create a symlink here");
  for (const target of [link, path.join(link, "new-data"), path.join(link, "new", "nested")]) {
    assert.throws(
      () => resolve(tmpdir(), { HOME: home, CAREER_OPS_ROOT: target }),
      (err) => err instanceof UnsafeDataRootError && err.root === target,
      target,
    );
  }
  assert.equal(fs.existsSync(path.join(core, "new-data")), false);
});

test("a folder named ..something inside the plugins cache is refused; a .. segment is not", () => {
  const home = tmpdir();
  const cache = path.join(home, ".claude", "plugins", "cache");
  const inside = path.join(cache, "..local", "data");
  assert.throws(
    () => resolve(tmpdir(), { HOME: home, CAREER_OPS_ROOT: inside }),
    (err) => err instanceof UnsafeDataRootError && err.root === inside,
  );
  const outside = path.join(home, ".claude", "plugins", "data");
  assert.equal(resolve(tmpdir(), { HOME: home, CAREER_OPS_ROOT: `${cache}${path.sep}..${path.sep}data` }), outside);
});

test("a relative marker in a plugin copy resolves inside it and is refused", () => {
  const { home, core } = pluginLayout();
  fs.writeFileSync(path.join(core, ".career-ops-data"), "./data");
  assert.throws(
    () => resolve(core, { HOME: home }),
    (err) => err instanceof UnsafeDataRootError && err.source === "The .career-ops-data marker" && err.root === path.join(core, "data"),
  );
});

test("unsafeDataRootMessage returns the refusal's one line, and null for anything else", () => {
  const { home, core } = pluginLayout();
  let caught;
  try {
    resolve(tmpdir(), { HOME: home, CAREER_OPS_ROOT: core });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.equal(unsafeDataRootMessage(caught), caught.message);
  assert.ok(!caught.message.includes("\n"));
  assert.equal(unsafeDataRootMessage(new Error("other")), null);
  assert.equal(unsafeDataRootMessage("CAREER_OPS_UNSAFE_DATA_ROOT"), null);
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
    // `plugin` places the fixture core inside a plugin install copy under the
    // fixture HOME; "INSIDE" is a folder inside that copy.
    { name: "plugin copy, no env, no marker", plugin: "cache", marker: null, env: {} },
    { name: "plugin copy under marketplaces/", plugin: "marketplaces", marker: null, env: {} },
    { name: "plugin copy under synced/", plugin: "synced", marker: null, env: {} },
    { name: "plugin copy under CLAUDE_CONFIG_DIR", plugin: "config-dir", marker: null, env: {} },
    { name: "plugin copy under CLAUDE_CODE_PLUGIN_CACHE_DIR", plugin: "cache-dir", marker: null, env: {} },
    { name: "plugin copy, empty marker", plugin: "cache", marker: "  \n", env: {} },
    { name: "plugin copy, absolute marker outside", plugin: "cache", marker: "ABS", env: {} },
    { name: "plugin copy, CAREER_OPS_ROOT outside", plugin: "cache", marker: null, env: { CAREER_OPS_ROOT: "ABS" } },
    { name: "plugin copy, relative marker inside", plugin: "cache", marker: "./data", env: {} },
    { name: "plugin copy, CAREER_OPS_ROOT inside", plugin: "cache", marker: null, env: { CAREER_OPS_ROOT: "INSIDE" } },
    { name: "plugin copy, CAREER_OPS_DATA_DIR inside", plugin: "cache", marker: null, env: { CAREER_OPS_DATA_DIR: "INSIDE" } },
    { name: "checkout, CAREER_OPS_ROOT inside a plugin copy", plugin: "elsewhere", marker: null, env: { CAREER_OPS_ROOT: "INSIDE" } },
    { name: "checkout, marker inside a plugin copy", plugin: "elsewhere", marker: "INSIDE", env: {} },
    // "LINK_MISSING" is a not-yet-created folder under a symlink to the copy (#7026).
    { name: "checkout, CAREER_OPS_ROOT under a symlink into a plugin copy", plugin: "elsewhere", marker: null, env: { CAREER_OPS_ROOT: "LINK_MISSING" } },
    { name: "checkout, marker under a symlink into a plugin copy", plugin: "elsewhere", marker: "LINK_MISSING", env: {} },
    // "DOTDOT_NAME" is a folder named "..local" inside the copy: a name, not a parent step.
    { name: "checkout, CAREER_OPS_ROOT under a ..-prefixed folder in a plugin copy", plugin: "elsewhere", marker: null, env: { CAREER_OPS_ROOT: "DOTDOT_NAME" } },
  ];

  // Every variable either resolver reads. Cleared before each case so the real
  // machine's settings (a CAREER_OPS_ROOT in ~/.claude/settings.json, a
  // CLAUDE_CONFIG_DIR) never reach a fixture.
  const READ = ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_CACHE_DIR", "HOME", "USERPROFILE"];

  /** The returned root, or the refusal's identifying fields. */
  const outcome = (fn) => {
    try {
      return { root: fn() };
    } catch (err) {
      return { name: err.name, code: err.code, source: err.source, root: err.root, message: err.message };
    }
  };

  for (const c of cases) {
    const home = tmpdir();
    const abs = tmpdir();
    const caseEnv = { HOME: home, USERPROFILE: home };

    // Where the plugin install copy lives, and which variable (if any) names its root.
    let copy = path.join(home, ".claude", "plugins", "cache", "career-ops", "career-ops", "1.0.0");
    if (c.plugin === "marketplaces" || c.plugin === "synced") {
      copy = path.join(home, ".claude", "plugins", c.plugin, "career-ops");
    } else if (c.plugin === "config-dir") {
      const config = tmpdir();
      caseEnv.CLAUDE_CONFIG_DIR = config;
      copy = path.join(config, "plugins", "cache", "career-ops", "career-ops", "1.0.0");
    } else if (c.plugin === "cache-dir") {
      const pluginsRoot = tmpdir();
      caseEnv.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginsRoot;
      copy = path.join(pluginsRoot, "cache", "career-ops", "career-ops", "1.0.0");
    }
    fs.mkdirSync(copy, { recursive: true });
    const core = c.plugin && c.plugin !== "elsewhere" ? copy : tmpdir();
    const inside = path.join(copy, "user-data");
    let linkMissing = null;
    if (Object.values(c.env).includes("LINK_MISSING") || c.marker === "LINK_MISSING") {
      const link = linkTo(copy);
      if (!link) continue; // no symlink privilege here: nothing to compare
      linkMissing = path.join(link, "new-data");
    }
    const subst = (v) => (v === "ABS" ? abs : v === "INSIDE" ? inside : v === "LINK_MISSING" ? linkMissing : v === "DOTDOT_NAME" ? path.join(copy, "..local", "data") : v);

    fs.copyFileSync(src, path.join(core, "path-resolver.mjs"));
    if (c.marker !== null) fs.writeFileSync(path.join(core, ".career-ops-data"), subst(c.marker));

    const env = { ...caseEnv, ...Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, subst(v)])) };

    const saved = { ...process.env };
    for (const k of READ) delete process.env[k];
    Object.assign(process.env, env);

    let core_answer;
    try {
      // cache-bust: each fixture is a distinct module instance
      const mod = await import(`${pathToFileURL(path.join(core, "path-resolver.mjs")).href}?c=${encodeURIComponent(c.name)}`);
      core_answer = outcome(() => mod.getCareerOpsRoot());
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, saved);
    }

    const web_answer = outcome(() => resolve(core, env));
    assert.deepEqual(web_answer, core_answer, `disagreement on: ${c.name}`);
  }
});

test("the cross-check exercises both plugin outcomes, so a silent skip cannot pass it", () => {
  // Guards the table above: if the fixture layout stopped matching a plugin
  // copy, every plugin case would fall to "the checkout itself" on both sides
  // and still agree.
  const { home, core } = pluginLayout();
  assert.notEqual(resolve(core, { HOME: home }), core);
  assert.throws(() => resolve(tmpdir(), { HOME: home, CAREER_OPS_ROOT: path.join(core, "x") }), UnsafeDataRootError);
});
