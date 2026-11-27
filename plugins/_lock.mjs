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

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, linkSync, mkdtempSync, rmSync, renameSync, readdirSync, lstatSync, statSync } from 'node:fs';
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
 * pass the hash while pointing elsewhere). Excludes .git, which git refuses to
 * check out below a clone's root, and node_modules, which a developer's linked
 * checkout fills with dependencies and symlinks. A community plugin cannot pin
 * one: install runs plugin-audit.mjs, which fails any tree containing
 * node_modules. `files` has no prototype, so a file named `__proto__` is kept.
 *
 * @param {string} dir absolute plugin directory
 * @returns {{ files: Record<string,string>, integrity: string }}
 */
export function hashPluginTree(dir) {
  const files = Object.create(null);
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

// A path counts as absent only when the OS says it does not exist. Any other
// stat failure (permissions, I/O) means the file's state is unknown, so the
// legacy fallback must not stand in for it.
function fileState(file) {
  try { statSync(file); return 'present'; }
  catch (err) { return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 'absent' : 'error'; }
}

/** Read plugins.lock (fail-open to an empty lock — like the rest of the engine). */
export function readLock(dataRoot, root = dataRoot) {
  let file = lockPath(dataRoot);
  const primary = fileState(file);
  if (primary === 'error') return { lockfileVersion: LOCK_VERSION, plugins: {} };
  if (primary === 'absent' && root && path.resolve(root) !== path.resolve(dataRoot)) {
    const fallback = lockPath(root);
    if (fileState(fallback) === 'present') file = fallback;
  }
  if (fileState(file) !== 'present') return { lockfileVersion: LOCK_VERSION, plugins: {} };
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
  if (fileState(target) !== 'absent') return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lockPath(root), 'utf8'));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.plugins || typeof parsed.plugins !== 'object' || Array.isArray(parsed.plugins)) return false;
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

// A torn file is not an empty lock. Reading it as empty and writing it back
// would drop every other pin. Reads the same file readLock does (the data-root
// lock, else a legacy code-root lock), so a damaged legacy lock is refused too
// instead of being migrated or re-pinned as if it were empty.
export function readLockForUpdate(dataRoot, root = dataRoot) {
  let file = lockPath(dataRoot);
  const unreadable = (f) => new Error(`plugins.lock at ${f} could not be checked, so it was left unchanged.`);
  const primary = fileState(file);
  if (primary === 'error') throw unreadable(file);
  if (primary === 'absent' && root && path.resolve(root) !== path.resolve(dataRoot)) {
    const fallback = lockPath(root);
    const legacy = fileState(fallback);
    if (legacy === 'error') throw unreadable(fallback);
    if (legacy === 'present') file = fallback;
  }
  // Only an absent file is an empty lock. An unreadable one here would drop
  // a stale pin's drift check, the same reason the probes above throw.
  const state = fileState(file);
  if (state === 'error') throw unreadable(file);
  if (state !== 'present') return { lockfileVersion: LOCK_VERSION, plugins: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`plugins.lock at ${file} is not valid JSON, so it was left unchanged.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.plugins || typeof parsed.plugins !== 'object' || Array.isArray(parsed.plugins)) {
    throw new Error(`plugins.lock at ${file} has no plugins map, so it was left unchanged.`);
  }
  return parsed;
}

function saveLock(dataRoot, lock) {
  const file = lockPath(dataRoot);
  const tmp = path.join(dataRoot, `.plugins.lock.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* the temp file may not exist */ }
    throw err;
  }
}

/** Merge a single entry into plugins.lock (never clobber other plugins' entries). */
export function writeLockEntry(dataRoot, id, entry, root = dataRoot) {
  const lock = readLockForUpdate(dataRoot, root);
  lock.lockfileVersion = LOCK_VERSION;
  lock.plugins[id] = entry;
  saveLock(dataRoot, lock);
}

export function removeLockEntry(dataRoot, id, root = dataRoot) {
  const lock = readLockForUpdate(dataRoot, root);
  if (!lock.plugins[id]) return;
  delete lock.plugins[id];
  saveLock(dataRoot, lock);
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
