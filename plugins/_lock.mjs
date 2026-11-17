// @ts-check
// plugins/_lock.mjs — integrity pinning for plugins (the rug-pull / OWASP-MCP04
// defense). Pure, side-effect-free import (node:crypto + node:fs only, NO
// child_process so it stays loadable under plugins/). plugins.lock is a USER-
// layer file (gitignored) recording, per enabled plugin, the sha256 of EVERY
// file in its directory + the consented capability surface.
//
// Honest scope: the lock is tamper-EVIDENCE, not containment. A local attacker
// with write access to plugins.local/ also has write access to plugins.lock and
// can re-pin. Its real value: catching a bundled-update tamper, a cross-plugin
// mutation, and a community plugin whose files changed since you trusted it
// WITHOUT a version bump (the postmark-mcp class). Stated plainly in README.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, linkSync, mkdtempSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';

const LOCK_VERSION = 1;

export function lockPath(dataRoot) {
  return path.join(dataRoot, 'plugins.lock');
}

function sha256(buf) {
  return 'sha256-' + createHash('sha256').update(buf).digest('hex');
}

/**
 * Hash EVERY regular file in a plugin directory tree, recursively. NOT a curated
 * subset — the entry can `import('./anything.mjs')`, so a partial hash would let
 * a rug-pull mutate an un-hashed file. Rejects symlinks (a symlinked file would
 * pass the hash while pointing elsewhere). Excludes node_modules + .git.
 *
 * @param {string} dir absolute plugin directory
 * @returns {{ files: Record<string,string>, integrity: string }}
 */
export function hashPluginTree(dir) {
  const files = {};
  const walk = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); }
    catch (err) { throw new Error(`cannot read ${rel || '.'}: ${err.message}`); }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      // lstat (not stat) so a symlink is detected, never followed.
      const st = lstatSync(childAbs);
      if (st.isSymbolicLink()) throw new Error(`refusing to hash symlink: ${childRel}`);
      if (st.isDirectory()) walk(childAbs, childRel);
      else if (st.isFile()) files[childRel] = sha256(readFileSync(childAbs));
      else throw new Error(`refusing to hash non-regular file: ${childRel}`);
    }
  };
  walk(dir, '');
  // Aggregate integrity = sha256 over the deterministic sorted "rel:hash" join.
  const aggregate = Object.keys(files).sort().map(k => `${k}:${files[k]}`).join('\n');
  return { files, integrity: sha256(Buffer.from(aggregate)) };
}

/** Read plugins.lock (fail-open to an empty lock — like the rest of the engine). */
export function readLock(dataRoot, root = dataRoot) {
  let file = lockPath(dataRoot);
  if (!existsSync(file) && root && path.resolve(root) !== path.resolve(dataRoot)) {
    const fallback = lockPath(root);
    if (existsSync(fallback)) file = fallback;
  }
  if (!existsSync(file)) return { lockfileVersion: LOCK_VERSION, plugins: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.plugins !== 'object') return { lockfileVersion: LOCK_VERSION, plugins: {} };
    return parsed;
  } catch {
    return { lockfileVersion: LOCK_VERSION, plugins: {} };
  }
}

/**
 * Persist a legacy code-root lock into the data root BEFORE lockGate relies on
 * the readLock fallback (#7177 review). Without it, a split layout whose
 * plugins all still match their legacy pins never writes
 * dataRoot/plugins.lock: moving plugins.local as warned then leaves the only
 * lock inside the replaceable code checkout, and the next load treats every
 * plugin as unpinned — accepting its current files instead of checking the
 * recorded consent. Every legacy entry is preserved verbatim through the same
 * write path writeLockEntry() uses. Best-effort by contract: a legacy lock
 * that does not parse is left where it is (readLock's fallback keeps serving
 * it) rather than replaced by an empty one. The publish is atomic and
 * no-replace (complete temp inside an exclusively created same-dir
 * directory, then a hard link): a failed write or publish never leaves a
 * PARTIAL final behind - on failure either the final stays absent (legacy
 * checks keep running) or it is a concurrent writer's complete lock, which
 * always wins. Only the directory this call provably owns is ever removed.
 *
 * @param {{writeFile?: Function, link?: Function}} [io] -
 *   injection point for tests (same pattern as wasEverShippedUpstream's
 *   revList); defaults to writeFileSync/linkSync.
 * @returns {boolean} true when this call published the data-root lock.
 */
export function migrateLegacyLock(dataRoot, root = dataRoot, io = {}) {
  const writeFile = io.writeFile || writeFileSync;
  const link = io.link || linkSync;
  if (!root || path.resolve(root) === path.resolve(dataRoot)) return false;
  const target = lockPath(dataRoot);
  if (existsSync(target)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lockPath(root), 'utf8'));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.plugins !== 'object' || parsed.plugins === null) return false;
  // Publish atomically: writing the final path directly (even with wx) can
  // leave a partial file behind when the write fails midway. readLock probes
  // existence, so a partial final masks the readable legacy lock and parses
  // to an empty lock — same-version drift then repins as unpinned instead of
  // failing the integrity check, and later migrations skip the existing
  // target, so it never heals (#7251 review). Write the complete lock to a
  // unique same-directory temp first, then publish it with a no-replace hard
  // link: a lock created concurrently still wins, exactly as wx did. A write
  // or publish failure removes only our own temp and leaves the final
  // absent, so the legacy fallback keeps serving the old pins; no fsync or
  // crash-durability guarantee is claimed beyond writeFileSync's own.
  // Ownership is structural, never inferred from error codes: the complete
  // lock is written inside a directory mkdtemp creates exclusively for this
  // call, then published with a no-replace hard link. Only that owned
  // directory is ever removed - a partial temp write, a racing winner, or an
  // unsupported filesystem can never make cleanup touch a foreign file.
  let tmpDir;
  try {
    tmpDir = mkdtempSync(path.join(path.dirname(target), `.migrate-${path.basename(target)}-`));
  } catch {
    return false; // cannot stage exclusively (permissions, read-only fs): nothing was created
  }
  try {
    writeFile(path.join(tmpDir, 'plugins.lock'), JSON.stringify({ ...parsed, lockfileVersion: parsed.lockfileVersion ?? LOCK_VERSION }, null, 2) + '\n', 'utf8');
    link(path.join(tmpDir, 'plugins.lock'), target);
  } catch {
    // Write failure: no final was created. Link EEXIST: a concurrent
    // writer's complete lock won between the probe and the publish - that
    // final takes precedence and is left untouched (no legacy fallback
    // applies over existing consent). EPERM/EXDEV/ENOSYS: this
    // platform/filesystem cannot hard-link - the final stays absent and the
    // legacy fallback keeps running.
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* an owned orphan dir is harmless */ }
    return false;
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* publish already landed; an owned orphan dir is harmless */ }
  return true;
}

/** Merge a single entry into plugins.lock (never clobber other plugins' entries). */
export function writeLockEntry(dataRoot, id, entry, root = dataRoot) {
  const lock = readLock(dataRoot, root);
  lock.lockfileVersion = LOCK_VERSION;
  lock.plugins[id] = entry;
  writeFileSync(lockPath(dataRoot), JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

export function removeLockEntry(dataRoot, id, root = dataRoot) {
  const lock = readLock(dataRoot, root);
  if (lock.plugins[id]) { delete lock.plugins[id]; writeFileSync(lockPath(dataRoot), JSON.stringify(lock, null, 2) + '\n', 'utf8'); }
}

/**
 * Compare a plugin's current tree + surface against its recorded lock entry.
 * `source` is derived by the CALLER from the filesystem (bundled vs local) —
 * NEVER trusted from the lock (a USER-writable file could spoof it).
 *
 * `changedFiles` is the union of `modified` (in the lock and now different),
 * `added` (not in the lock) and `removed` (in the lock, gone from the tree).
 *
 * @returns {{ status: 'unpinned'|'match'|'drift-nobump'|'legit-update'|'surface-widened', changedFiles: string[], modified: string[], added: string[], removed: string[], addedHosts: string[], addedEnv: string[] }}
 */
export function diffPlugin(manifest, lockEntry) {
  const none = { changedFiles: [], modified: [], added: [], removed: [] };
  if (!lockEntry) return { status: 'unpinned', ...none, addedHosts: [], addedEnv: [] };
  const tree = hashPluginTree(manifest.dir);
  const addedHosts = (manifest.allowedHosts || []).filter(h => !(lockEntry.consent?.allowedHosts || []).includes(h));
  const addedEnv = (manifest.requiredEnv || []).filter(e => !(lockEntry.consent?.requiredEnv || []).includes(e));
  const surfaceWidened = addedHosts.length > 0 || addedEnv.length > 0 ||
    (manifest.allowsLocalhost === true && lockEntry.consent?.allowsLocalhost !== true);

  if (tree.integrity === lockEntry.integrity) {
    return surfaceWidened
      ? { status: 'surface-widened', ...none, addedHosts, addedEnv }
      : { status: 'match', ...none, addedHosts, addedEnv };
  }
  // Files changed. Which?
  const prev = lockEntry.files || {};
  const changedFiles = [...new Set([...Object.keys(tree.files), ...Object.keys(prev)])]
    .filter(f => tree.files[f] !== prev[f]);
  const inTree = f => Object.hasOwn(tree.files, f);
  const inLock = f => Object.hasOwn(prev, f);
  const drift = {
    changedFiles,
    modified: changedFiles.filter(f => inTree(f) && inLock(f)).sort(),
    added: changedFiles.filter(f => inTree(f) && !inLock(f)).sort(),
    removed: changedFiles.filter(f => !inTree(f)).sort(),
  };
  if (surfaceWidened) return { status: 'surface-widened', ...drift, addedHosts, addedEnv };
  // A version bump distinguishes an honest update from a stealth mutation.
  const bumped = compareVersions(manifest.version, lockEntry.version) > 0;
  return { status: bumped ? 'legit-update' : 'drift-nobump', ...drift, addedHosts, addedEnv };
}

const DRIFT_LIST_CAP = 5;

/**
 * One-line account of a drifted tree for the tamper warning. Paths of each kind
 * (modified, removed, added) are grouped: a file at the plugin root is named,
 * every other path counts toward its top-level directory, and a directory with
 * a single changed file names that file. A worktree or a log directory
 * therefore reads as one item whichever kind its files fall under, and an edit
 * to a root file always has an item of its own. The hash itself is
 * untouched: this only describes it.
 *
 * @param {{ modified: string[], added: string[], removed: string[] }} drift
 * @returns {string}
 */
export function describeDrift({ modified, added, removed }) {
  const group = (paths) => {
    const roots = [];
    const dirs = new Map();
    for (const f of paths) {
      const slash = f.indexOf('/');
      if (slash === -1) roots.push(f);
      else {
        const dir = f.slice(0, slash + 1);
        dirs.set(dir, [...(dirs.get(dir) || []), f]);
      }
    }
    const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const items = [
      ...roots.sort(byName),
      ...[...dirs].sort(([a, fa], [b, fb]) => fb.length - fa.length || byName(a, b))
        .map(([d, files]) => (files.length === 1 ? files[0] : `${d} (${files.length})`)),
    ];
    return items.slice(0, DRIFT_LIST_CAP).join(', ') +
      (items.length > DRIFT_LIST_CAP ? ` and ${items.length - DRIFT_LIST_CAP} more groups` : '');
  };
  const parts = [];
  if (modified.length) parts.push(`${modified.length} modified: ${group(modified)}`);
  if (removed.length) parts.push(`${removed.length} removed: ${group(removed)}`);
  if (added.length) parts.push(`${added.length} added: ${group(added)}`);
  return parts.join('; ');
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

/** Build the consent surface recorded in a lock entry. */
export function consentSurface(manifest) {
  return {
    hooks: [...manifest.hooks],
    requiredEnv: [...manifest.requiredEnv],
    allowedHosts: [...manifest.allowedHosts],
    skill: Boolean(manifest.skill),
    allowsLocalhost: manifest.allowsLocalhost === true,
  };
}
