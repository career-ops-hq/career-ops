// Plain .mjs (same pattern as run-cli-support.mjs / tracker-table.mjs) so
// tests/lib/data-root.test.mjs can import it directly under Node. Import it with
// the .mjs extension included.
import path from "node:path";

/**
 * Resolve the career-ops data root, matching the core's `path-resolver.mjs`
 * `getCareerOpsRoot()` EXACTLY: the same four steps, and the same refusal.
 *
 *   1. `CAREER_OPS_ROOT`, then `CAREER_OPS_DATA_DIR`
 *   2. the `.career-ops-data` marker in the checkout
 *   3. `~/career-ops-data` when the checkout is a Claude Code plugin install copy
 *   4. the checkout itself
 *
 * A value from step 1 or 2 that lands inside a plugin install copy throws
 * `UnsafeDataRootError` instead of being returned (AGENTS.md, "Path Resolution
 * Override & Precedence"; docs/CLAUDE_PLUGIN.md).
 *
 * WHY THIS EXISTS — the divergence it closes:
 *
 * `web/`'s resolver honored only `CAREER_OPS_ROOT`, then fell back to the
 * parent directory. A user with a marker file therefore had the CLI and the web
 * app reading two different data roots, with nothing reporting the
 * disagreement. Steps 3 and the refusal came later (#5712) and were missing
 * here too: a web app whose checkout was a plugin copy (run from inside it, or
 * pointed at it with `CAREER_OPS_CODE_ROOT`) read and wrote the user's files in
 * a folder Claude Code deletes on the next plugin update, while the CLI used
 * `~/career-ops-data`.
 *
 * THE SUBTLE HALF — the resolution BASE, not just the order:
 *
 * `path-resolver.mjs` resolves relative values against `__dirname`, i.e. the
 * CORE CHECKOUT. `web/` runs with `process.cwd() === <core>/web`, so resolving
 * a relative value against the cwd points one directory too deep. A marker
 * containing `../shared-data` would mean `<core>/../shared-data` to the CLI and
 * `<core>/web/../shared-data` — i.e. `<core>/shared-data` — to the web app.
 * Same string, two directories, no error. `coreRoot` is therefore a required
 * argument here: it is the one value that must agree with the core's
 * `__dirname`, and making it explicit keeps it from being silently re-derived.
 *
 * NOT IMPLEMENTED BY IMPORTING THE CORE, deliberately: `path-resolver.mjs`
 * derives `__dirname` from `import.meta.url`. Bundled into the Next server
 * output, that URL becomes the bundle's location rather than the checkout's, so
 * importing it would resolve relative values against `.next/server/...`, and
 * would ask whether `.next/server/...` is a plugin copy. The import would look
 * more DRY and be silently wrong. `tests/lib/data-root.test.mjs` pins the two
 * implementations together instead, plugin branches included.
 *
 * Absolute env values and marker contents are unaffected — `path.resolve` returns
 * an absolute input unchanged — so every existing install keeps its current root.
 *
 * @param {string} coreRoot Absolute path to the career-ops checkout (path-resolver's `__dirname`).
 * @param {(p: string) => string | null} readMarker Reads a file, or null when absent/unreadable.
 * @param {NodeJS.ProcessEnv} env
 * @param {(...parts: string[]) => string} resolve `path.resolve`
 * @param {(...parts: string[]) => string} join `path.join`
 * @param {PluginHost} host Home directory, realpath and platform, for the plugin-copy check.
 * @returns {string} Absolute data root.
 * @throws {UnsafeDataRootError} When the environment or the marker names a folder inside a plugin install copy.
 */
export function resolveDataRoot(coreRoot, readMarker, env, resolve, join, host) {
  // Precedence order is the core's, including CAREER_OPS_ROOT winning over
  // CAREER_OPS_DATA_DIR when both are set.
  const envName = env.CAREER_OPS_ROOT?.trim() ? "CAREER_OPS_ROOT" : "CAREER_OPS_DATA_DIR";
  const fromEnv = env.CAREER_OPS_ROOT?.trim() || env.CAREER_OPS_DATA_DIR?.trim();
  if (fromEnv) return explicitRoot(resolve(coreRoot, fromEnv), envName, env, host);

  const marker = readMarker(join(coreRoot, ".career-ops-data"));
  if (marker) {
    const content = marker.trim();
    // An empty or whitespace-only marker is not a root — the core falls through
    // to its default rather than resolving to `coreRoot` by accident, and a
    // disagreement here would be invisible.
    if (content) return explicitRoot(resolve(coreRoot, content), "The .career-ops-data marker", env, host);
  }

  // A plugin install copy is replaced on every plugin update, so the code root
  // can't double as the data root there.
  if (isPluginInstallCopy(coreRoot, env, host)) return pluginDefaultDataRoot(host);

  return coreRoot;
}

/**
 * What the plugin-copy check needs from the machine, injected so tests can point
 * it at a fixture home.
 *
 * @typedef {object} PluginHost
 * @property {() => string} homedir `os.homedir`
 * @property {(p: string) => string} realpath `fs.realpathSync`; may throw for a path not on disk
 * @property {string} platform `process.platform`
 */

// The directories under Claude Code's plugins root that hold a plugin's files
// on Claude Code's behalf. Same list as path-resolver.mjs's PLUGIN_COPY_SUBDIRS.
const PLUGIN_COPY_SUBDIRS = ["cache", "marketplaces", "synced"];

/**
 * Claude Code's plugins roots: CLAUDE_CODE_PLUGIN_CACHE_DIR when set, and
 * `plugins/` under the config directory (CLAUDE_CONFIG_DIR, else ~/.claude).
 * Mirrors path-resolver.mjs's claudePluginsRoots().
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {PluginHost} host
 * @returns {string[]}
 */
export function claudePluginsRoots(env, host) {
  const roots = [];
  const cacheDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim();
  if (cacheDir) roots.push(path.resolve(cacheDir));
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  roots.push(path.join(configDir ? path.resolve(configDir) : path.join(host.homedir(), ".claude"), "plugins"));
  return roots;
}

// The path with its symlinks resolved. A path not on disk yet resolves through
// its nearest existing ancestor, so `<link-to-plugin-copy>/new-data` reads as
// inside the copy just like `<link>` does (#7026). Null when nothing resolves.
// Mirrors path-resolver.mjs's realSpelling().
function realSpelling(p, host) {
  try {
    return host.realpath(p);
  } catch {
    // Not on disk yet: resolve the nearest ancestor that is.
  }
  const missing = [];
  let current = path.resolve(p);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    missing.unshift(path.basename(current));
    current = parent;
    try {
      return path.join(host.realpath(current), ...missing);
    } catch {
      // Keep walking up.
    }
  }
}

function spellings(p, host) {
  const out = [path.resolve(p)];
  const real = realSpelling(p, host);
  if (real) out.push(real);
  return host.platform === "win32" ? out.map((s) => s.toLowerCase()) : out;
}

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  // A ".." segment leaves the parent; a name like "..local" stays inside it.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * True when `dir` is inside a copy Claude Code keeps for an installed plugin.
 * Mirrors path-resolver.mjs's isPluginInstallCopy().
 *
 * @param {string} dir
 * @param {NodeJS.ProcessEnv} env
 * @param {PluginHost} host
 * @returns {boolean}
 */
export function isPluginInstallCopy(dir, env, host) {
  const candidates = spellings(dir, host);
  return claudePluginsRoots(env, host).some((root) => PLUGIN_COPY_SUBDIRS.some((sub) => {
    const parents = spellings(path.join(root, sub), host);
    return candidates.some((c) => parents.some((p) => isWithin(c, p)));
  }));
}

/**
 * Where a plugin install keeps the user's files when neither the environment
 * nor a marker says where: ~/career-ops-data.
 *
 * @param {PluginHost} host
 * @returns {string}
 */
export function pluginDefaultDataRoot(host) {
  return path.join(host.homedir(), "career-ops-data");
}

/**
 * Thrown when an explicit data root (an environment variable or the marker
 * file) resolves inside a plugin install copy. Same name, code, fields and
 * message as path-resolver.mjs's UnsafeDataRootError, so the web app and the
 * CLI refuse the same folder with the same words.
 */
export class UnsafeDataRootError extends Error {
  /**
   * @param {string} root
   * @param {string} source
   * @param {PluginHost} host
   */
  constructor(root, source, host) {
    super(
      `${source} points inside a Claude Code plugin install (${root}), which Claude Code replaces on every plugin update. ` +
      `Set it to a folder outside ~/.claude/plugins, or remove it to use ${pluginDefaultDataRoot(host)}.`,
    );
    this.name = "UnsafeDataRootError";
    this.code = "CAREER_OPS_UNSAFE_DATA_ROOT";
    this.root = root;
    this.source = source;
  }
}

function explicitRoot(root, source, env, host) {
  if (isPluginInstallCopy(root, env, host)) throw new UnsafeDataRootError(root, source, host);
  return root;
}

/**
 * The one-line message of an UnsafeDataRootError, or null for any other value.
 * Matched on `code`, not `instanceof`, so it also recognises the core's own
 * error class. Callers that already turn a missing data folder into a message
 * use this to turn a refused one into a message too, instead of a 500.
 *
 * @param {unknown} err
 * @returns {string | null}
 */
export function unsafeDataRootMessage(err) {
  return err instanceof Error && /** @type {{code?: unknown}} */ (err).code === "CAREER_OPS_UNSAFE_DATA_ROOT" ? err.message : null;
}

/** One line for a data root that is not a directory. No stack, no second sentence. */
export function dataFolderMissingMessage(root) {
  return `Career-Ops data folder not found at ${root}. Set CAREER_OPS_ROOT or CAREER_OPS_DATA_DIR, or run node onboard-write.mjs`;
}
