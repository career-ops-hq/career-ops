import { resolve, dirname, join, basename, parse, sep, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The directories under Claude Code's plugins root that hold a plugin's files
// on Claude Code's behalf: cache/ (the per-version copy an install loads),
// marketplaces/ (the marketplace clone, re-fetched on refresh) and synced/
// (plugins synced from claude.ai). Claude Code replaces each of them on its
// own schedule, so none of them can hold a user's files.
const PLUGIN_COPY_SUBDIRS = ['cache', 'marketplaces', 'synced'];

/**
 * Claude Code's plugins roots: CLAUDE_CODE_PLUGIN_CACHE_DIR when set, and
 * `plugins/` under the config directory (CLAUDE_CONFIG_DIR, else ~/.claude).
 * Both are listed because the variable may be set for one process and not
 * another, and a copy under either is still a copy.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function claudePluginsRoots(env = process.env) {
  const roots = [];
  const cacheDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim();
  if (cacheDir) roots.push(resolve(cacheDir));
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  roots.push(join(configDir ? resolve(configDir) : join(homedir(), '.claude'), 'plugins'));
  return roots;
}

function spellings(path) {
  const out = [resolve(path)];
  try {
    out.push(realpathSync(path));
  } catch {
    // Not on disk yet: the lexical spelling is all there is.
  }
  return process.platform === 'win32' ? out.map((p) => p.toLowerCase()) : out;
}

function isWithin(child, parent) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * True when `dir` is inside a copy Claude Code keeps for an installed plugin
 * (see PLUGIN_COPY_SUBDIRS). A checkout loaded in place, such as a marketplace
 * added from a local path or a project's .claude/skills/, is not a copy.
 *
 * @param {string} [dir] Defaults to this file's own directory: the code root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isPluginInstallCopy(dir = __dirname, env = process.env) {
  const candidates = spellings(dir);
  return claudePluginsRoots(env).some((root) => PLUGIN_COPY_SUBDIRS.some((sub) => {
    const parents = spellings(join(root, sub));
    return candidates.some((c) => parents.some((p) => isWithin(c, p)));
  }));
}

/**
 * Where a plugin install keeps the user's files when neither the environment
 * nor a marker says where: ~/career-ops-data.
 *
 * @returns {string}
 */
export function pluginDefaultDataRoot() {
  return join(homedir(), 'career-ops-data');
}

/**
 * Thrown by getCareerOpsRoot() when an explicit data root (an environment
 * variable or the marker file) resolves inside a plugin install copy. Claude
 * Code deletes that copy on the next plugin update, so every write there would
 * be lost. The override is refused rather than redirected: it names a folder
 * on purpose, and silently writing somewhere else would hide the mistake.
 */
export class UnsafeDataRootError extends Error {
  constructor(root, source) {
    super(
      `${source} points inside a Claude Code plugin install (${root}), which Claude Code replaces on every plugin update. ` +
      `Set it to a folder outside ~/.claude/plugins, or remove it to use ${pluginDefaultDataRoot()}.`,
    );
    this.name = 'UnsafeDataRootError';
    this.code = 'CAREER_OPS_UNSAFE_DATA_ROOT';
    this.root = root;
    this.source = source;
  }
}

function explicitRoot(root, source) {
  if (isPluginInstallCopy(root)) throw new UnsafeDataRootError(root, source);
  return root;
}

/**
 * Returns the resolved career-ops data directory root.
 * Priority: process.env.CAREER_OPS_ROOT or process.env.CAREER_OPS_DATA_DIR >
 * .career-ops-data marker file > ~/career-ops-data when the code root is a
 * Claude Code plugin install copy > codebase root (__dirname).
 *
 * @returns {string} Absolute path to the data root
 * @throws {UnsafeDataRootError} When the environment or the marker names a
 *   folder inside a plugin install copy
 */
export function getCareerOpsRoot() {
  const envName = process.env.CAREER_OPS_ROOT?.trim() ? 'CAREER_OPS_ROOT' : 'CAREER_OPS_DATA_DIR';
  const env = process.env.CAREER_OPS_ROOT?.trim() || process.env.CAREER_OPS_DATA_DIR?.trim();
  if (env) {
    return explicitRoot(resolve(__dirname, env), envName);
  }
  const markerFile = join(__dirname, '.career-ops-data');
  if (existsSync(markerFile)) {
    let content = '';
    try {
      content = readFileSync(markerFile, 'utf-8').trim();
    } catch {
      // ignore read errors
    }
    if (content) {
      return explicitRoot(resolve(__dirname, content), 'The .career-ops-data marker');
    }
  }
  // A plugin install copy is replaced on every plugin update, so the code
  // root can't double as the data root there.
  if (isPluginInstallCopy(__dirname)) {
    return pluginDefaultDataRoot();
  }
  return __dirname;
}

/**
 * True when CAREER_OPS_PROFILE names a profile. Callers that must tell "an
 * override is set" from "none" use this instead of comparing paths: an override
 * may name the data-root profile itself.
 *
 * @returns {boolean}
 */
export function hasProfileOverride() {
  return Boolean(process.env.CAREER_OPS_PROFILE?.trim());
}

/**
 * Returns the path to the user's config/profile.yml.
 * Priority: rootDir argument > process.env.CAREER_OPS_PROFILE > data root.
 * A relative override resolves against the working directory, like the other
 * lane variables (CAREER_OPS_PORTALS, CAREER_OPS_PIPELINE, CAREER_OPS_SCAN_HISTORY).
 *
 * Every reader of the profile resolves it here. The override used to be
 * copied by hand into a handful of modules while the rest built the data-root
 * path themselves, so one install could read two different profiles (#5026).
 * A caller that passes its own rootDir has already said which workspace it
 * means, so the environment does not redirect it.
 *
 * @param {string} [rootDir] Explicit workspace root, when the caller has one
 * @returns {string} Path to the profile file: absolute unless the caller passed a relative rootDir
 */
export function getProfilePath(rootDir) {
  if (rootDir) return join(rootDir, 'config', 'profile.yml');
  const override = process.env.CAREER_OPS_PROFILE?.trim();
  return override ? resolve(override) : join(getCareerOpsRoot(), 'config', 'profile.yml');
}

/**
 * Canonicalize a tracker path: absolute + realpath (macOS's symlinked tmpdir
 * among others). This must be applied by EVERY resolver of the same tracker:
 * two implementations briefly coexisted, the un-canonicalized one derived
 * different lock paths (/var vs /private/var) for the same file, and shared
 * writer exclusion silently broke. This module is the single source of truth;
 * tracker-utils.mjs re-exports from here so both import paths agree.
 * Deliberately dependency-light (fs/path only): test fixtures copy this file
 * standalone next to the scripts they exercise.
 */
export function canonicalizeTrackerPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

/**
 * The spelling the Go dashboard canonicalizes a path to, for the tracker lock.
 *
 * Only the lock may use it. Every other path in the repository is compared with
 * realpathSync() spellings, so returning it from canonicalizeTrackerPath() made
 * a short %TEMP% fail containment and backup-path checks across the tracker
 * scripts.
 *
 * @param {string} path - An absolute path, already through realpathSync.
 * @returns {string} The path with each component as the filesystem stores it on
 *   Windows; unchanged elsewhere.
 */
export function storedSpelling(path) {
  return process.platform === 'win32' ? namesAsStoredOnWindows(path) : path;
}

/**
 * Spell each component of a Windows path the way the filesystem stores it.
 *
 * realpathSync() resolves links but keeps a component as it was written, so an
 * 8.3 short name (`C:\Users\RUNNER~1\...`, which %TEMP% often is) stays short.
 * The Go dashboard canonicalizes with filepath.EvalSymlinks, which writes the
 * long name, and the lock name is a hash of the path string: the two languages
 * derived two lock directories for one tracker and stopped excluding each other
 * (#4957). realpathSync.native() would expand the short name, but it also
 * resolves a `subst` drive to the directory behind it, which Go keeps as
 * written, so it would trade this divergence for another. Only each
 * component's own name is taken from it; the drive or share stays as given,
 * except that a drive letter is upper-cased, as EvalSymlinks writes it
 * (realpathSync keeps `c:\` as it was typed).
 *
 * @param {string} path - An absolute path with no links left in it.
 * @returns {string}
 */
function namesAsStoredOnWindows(path) {
  const { root } = parse(path);
  let out = /^[a-z]:/.test(root) ? root[0].toUpperCase() + root.slice(1) : root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    let name = part;
    try {
      name = basename(realpathSync.native(join(out, part)));
    } catch {
      // Unreadable here: keep the component as realpathSync wrote it.
    }
    out = join(out, name);
  }
  return out;
}

/**
 * Returns the canonical path to the tracker applications.md file for reading.
 * Priority: process.env.CAREER_OPS_TRACKER > root/data/applications.md > root/applications.md.
 *
 * @param {string} rootDir The career-ops data root directory
 * @returns {string} Canonical absolute path to the tracker file
 */
export function resolveTrackerPath(rootDir) {
  return canonicalizeTrackerPath(rawTrackerPath(rootDir));
}

/**
 * The tracker path before canonicalization: the lexical location, with no
 * symlink along the path resolved. resolveTrackerPath() realpaths this for the
 * lock key, but workspace derivation uses the raw form instead (see
 * resolveWorkspaceRootFor) so a symlinked `data/` does not realpath the
 * workspace out of the repo (#3169).
 *
 * @param {string} rootDir The career-ops data root directory
 * @returns {string} Uncanonicalized tracker path
 */
export function rawTrackerPath(rootDir) {
  const env = process.env.CAREER_OPS_TRACKER?.trim();
  return env
    ? env
    : existsSync(join(rootDir, 'data/applications.md'))
      ? join(rootDir, 'data/applications.md')
      : join(rootDir, 'applications.md');
}

/**
 * Returns the resolved path to the tracker applications.md file for writing.
 * Priority: process.env.CAREER_OPS_TRACKER > root/data/applications.md.
 * Does not check for file existence, providing a deterministic write target.
 * 
 * @param {string} root The career-ops data root directory
 * @returns {string} Absolute path to the tracker file for writing
 */
export function resolveTrackerPathForWrite(root) {
  const env = process.env.CAREER_OPS_TRACKER?.trim();
  if (env) {
    // Same canonicalization as the read path (see canonicalizeTrackerPath): an
    // un-canonicalized env override derives divergent lock paths on symlinked
    // tmpdirs and breaks shared writer exclusion.
    return canonicalizeTrackerPath(env);
  }
  return join(root, 'data/applications.md');
}

