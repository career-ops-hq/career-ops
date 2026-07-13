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
import { existsSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';

const LOCK_VERSION = 1;

export function lockPath(root) {
  return path.join(root, 'plugins.lock');
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
export function readLock(root) {
  const file = lockPath(root);
  if (!existsSync(file)) return { lockfileVersion: LOCK_VERSION, plugins: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.plugins !== 'object') return { lockfileVersion: LOCK_VERSION, plugins: {} };
    return parsed;
  } catch {
    return { lockfileVersion: LOCK_VERSION, plugins: {} };
  }
}

/** Merge a single entry into plugins.lock (never clobber other plugins' entries). */
export function writeLockEntry(root, id, entry) {
  const lock = readLock(root);
  lock.lockfileVersion = LOCK_VERSION;
  lock.plugins[id] = entry;
  writeFileSync(lockPath(root), JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

export function removeLockEntry(root, id) {
  const lock = readLock(root);
  if (lock.plugins[id]) { delete lock.plugins[id]; writeFileSync(lockPath(root), JSON.stringify(lock, null, 2) + '\n', 'utf8'); }
}

/**
 * Compare a plugin's current tree + surface against its recorded lock entry.
 * `source` is derived by the CALLER from the filesystem (bundled vs local) —
 * NEVER trusted from the lock (a USER-writable file could spoof it).
 *
 * @returns {{ status: 'unpinned'|'match'|'drift-nobump'|'legit-update'|'surface-widened', changedFiles: string[], addedHosts: string[], addedEnv: string[] }}
 */
export function diffPlugin(manifest, lockEntry) {
  if (!lockEntry) return { status: 'unpinned', changedFiles: [], addedHosts: [], addedEnv: [] };
  const tree = hashPluginTree(manifest.dir);
  const addedHosts = (manifest.allowedHosts || []).filter(h => !(lockEntry.consent?.allowedHosts || []).includes(h));
  const addedEnv = (manifest.requiredEnv || []).filter(e => !(lockEntry.consent?.requiredEnv || []).includes(e));
  const surfaceWidened = addedHosts.length > 0 || addedEnv.length > 0 ||
    (manifest.allowsLocalhost === true && lockEntry.consent?.allowsLocalhost !== true);

  if (tree.integrity === lockEntry.integrity) {
    return surfaceWidened
      ? { status: 'surface-widened', changedFiles: [], addedHosts, addedEnv }
      : { status: 'match', changedFiles: [], addedHosts, addedEnv };
  }
  // Files changed. Which?
  const prev = lockEntry.files || {};
  const changedFiles = [...new Set([...Object.keys(tree.files), ...Object.keys(prev)])]
    .filter(f => tree.files[f] !== prev[f]);
  if (surfaceWidened) return { status: 'surface-widened', changedFiles, addedHosts, addedEnv };
  // A version bump distinguishes an honest update from a stealth mutation.
  const bumped = compareVersions(manifest.version, lockEntry.version) > 0;
  return { status: bumped ? 'legit-update' : 'drift-nobump', changedFiles, addedHosts, addedEnv };
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
