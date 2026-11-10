// @ts-check
// lib/templates-install.mjs — install, list and remove template packs (#5951,
// #1778). The analog of plugin-install.mjs plus plugins/_lock.mjs, for passive
// data: it reads the files a validated pack declares and copies them into
// templates/<id>/, the one-level pack directory cv-templates.mjs already
// discovers (#3202). Nothing from the pack is executed.
//
// templates.lock is a USER-layer, gitignored file. Like plugins.lock it is
// tamper-evidence, not containment: it records a sha256 per installed file so
// `list` can say a file changed and `remove` can refuse to delete an edit.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listTemplates } from '../cv-templates.mjs';
import { validatePack, ID_RE } from '../validate-template-pack.mjs';
import { NAME_PREFIX, REPO_RE } from './templates-registry.mjs';

const LOCK_VERSION = 1;
const SHA_RE = /^[0-9a-f]{40}$/;

export const lockPath = (root) => path.join(root, 'templates.lock');
// Absolute, so a relative root still compares equal to the path.resolve()d lock paths.
const templatesDir = (root) => path.resolve(root, 'templates');
const sha256 = (buf) => 'sha256-' + createHash('sha256').update(buf).digest('hex');

/**
 * Read templates.lock. Only an absent file is an empty lock: a corrupt or
 * unreadable one is an error, because the next write would replace it and every
 * installed pack would lose its attribution.
 */
export function readLock(root) {
  let text;
  try {
    text = readFileSync(lockPath(root), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { lockfileVersion: LOCK_VERSION, packs: {} };
    throw new Error(`templates.lock is unreadable (${err.message}); fix or move it aside`);
  }
  let p;
  try {
    p = JSON.parse(text);
  } catch (err) {
    throw new Error(`templates.lock is not valid JSON (${err.message}); fix or move it aside`);
  }
  if (!p || typeof p !== 'object' || !p.packs || typeof p.packs !== 'object' || Array.isArray(p.packs)) {
    throw new Error('templates.lock has an unexpected shape (no "packs" object); fix or move it aside');
  }
  return p;
}

// Written through a temp file in the same directory and renamed into place, so
// a crash or a concurrent `list` never sees a partial file.
function writeLock(root, lock) {
  lock.lockfileVersion = LOCK_VERSION;
  const tmp = `${lockPath(root)}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    renameSync(tmp, lockPath(root));
  } catch (err) {
    // Best effort: a cleanup that fails too must not replace the write's own error.
    try { rmSync(tmp, { force: true, recursive: false }); } catch { /* leave it; the write error is the one to report */ }
    throw err;
  }
}

/** `https://github.com/<owner>/career-ops-template-<id>` -> `{url, id}`; throws otherwise. */
export function parseRepoUrl(arg) {
  const url = String(arg || '').replace(/\.git$/, '');
  if (!REPO_RE.test(url)) throw new Error(`refusing a non-GitHub repo URL: ${arg} (expected https://github.com/<owner>/${NAME_PREFIX}<id>)`);
  const repo = url.split('/').pop() || '';
  if (!repo.startsWith(NAME_PREFIX) || repo.length === NAME_PREFIX.length) {
    throw new Error(`repo must be named "${NAME_PREFIX}<id>" (got "${repo}")`);
  }
  return { url, id: repo.slice(NAME_PREFIX.length) };
}

/** Names a pack's templates would claim, per kind. */
function claims(pack) {
  const out = { cv: [], cover: [] };
  for (const t of pack.templates) {
    if (t.kind === 'cv' || t.kind === 'both') out.cv.push(t.id);
    if (t.kind === 'cover' || t.kind === 'both') out.cover.push(t.id);
  }
  return out;
}

function checkAgainstRegistry(entry, pack) {
  const themes = pack.templates.length;
  const kinds = new Set(pack.templates.flatMap((t) => (t.kind === 'both' ? ['cv', 'cover'] : [t.kind])));
  const problems = [];
  if (pack.id !== entry.id) problems.push(`id: registry "${entry.id}", pack.json "${pack.id}"`);
  if (pack.version !== entry.version) problems.push(`version: registry "${entry.version}", pack.json "${pack.version}"`);
  if (themes !== entry.themes) problems.push(`themes: registry ${entry.themes}, pack.json ${themes}`);
  if (pack.templates.every((t) => t.ats === true) !== entry.ats) problems.push(`ats: registry ${entry.ats}, pack.json disagrees`);
  if ([...kinds].sort().join() !== [...entry.kind].sort().join()) problems.push(`kind: registry ${JSON.stringify(entry.kind)}, pack.json ${JSON.stringify([...kinds])}`);
  if (problems.length) throw new Error(`the pack at the pinned commit disagrees with its registry entry:\n  ✗ ${problems.join('\n  ✗ ')}`);
}

/**
 * Install a pack. Pass a registry `entry` (its repo and sha are used) or a
 * `repoUrl` plus `sha` for an unregistered pack. `clone(url, sha)` returns a
 * temp directory holding the pack at exactly that commit.
 * @returns {{id: string, version: string, sha: string, source: string, files: string[]}}
 */
export function installPack(root, { entry = null, repoUrl = null, sha = null, clone, force = false }) {
  const url = entry ? entry.repo : repoUrl;
  const pin = entry ? entry.sha : sha;
  const source = entry ? 'registry' : 'unverified';
  const parsed = parseRepoUrl(url);
  if (!SHA_RE.test(pin || '')) throw new Error(`a 40-hex commit sha is required (got ${JSON.stringify(pin)})`);

  const dir = clone(parsed.url, pin);
  try {
    const problems = validatePack(dir);
    if (problems.length) throw new Error(`the pack failed validation:\n  ✗ ${problems.join('\n  ✗ ')}`);
    const pack = JSON.parse(readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    if (pack.id !== parsed.id) throw new Error(`repo "${parsed.url}" is named for id "${parsed.id}" but pack.json says "${pack.id}"`);
    if (entry) checkAgainstRegistry(entry, pack);

    const id = pack.id;
    const lock = readLock(root);
    const dest = path.join(templatesDir(root), id);
    const lockedHere = Object.hasOwn(lock.packs, id);
    if (existsSync(dest) && !lockedHere) throw new Error(`templates/${id}/ exists and was not installed by templates.mjs; move it aside first`);
    if (lockedHere && !force) throw new Error(`pack "${id}" is already installed; pass --force to replace it`);

    // The collision check ignores this pack's own previous files, so a forced
    // reinstall can be checked before anything is deleted.
    for (const kind of /** @type {const} */ (['cv', 'cover'])) {
      const taken = new Set(listTemplates(kind, { dir: templatesDir(root) }).filter((t) => t.pack !== id).map((t) => t.name));
      for (const name of claims(pack)[kind]) {
        if (taken.has(name)) throw new Error(`${kind} template name "${name}" is already taken; discovery would reject two files with one name`);
      }
    }

    // A forced reinstall removes only the files the old lock lists, so a file
    // the user put in templates/<id>/ survives it. The new pack must therefore
    // not write over one: refuse before anything is deleted.
    const previous = lockedHere ? lock.packs[id] : null;
    const owned = new Set(Object.keys(previous?.files || {}));
    for (const t of pack.templates) {
      for (const kind of t.kind === 'both' ? ['cv', 'cover'] : [t.kind]) {
        const rel = `templates/${id}/${path.basename(t.files[kind])}`;
        const abs = path.join(dest, path.basename(t.files[kind]));
        const present = (() => { try { lstatSync(abs); return true; } catch { return false; } })();
        if (present && !owned.has(rel)) throw new Error(`${rel} exists and is not owned by the installed pack; move it aside first`);
      }
    }

    // A forced reinstall removes the old files only after snapshotting them, so
    // any later failure can put the previous version back.
    const snapshot = {};
    if (previous) {
      const unreadable = [];
      const targets = lockTargets(root, id, previous);
      // The pack installed regular files. A symlink in place of one would be read
      // through for this backup, and the copy below would write through it.
      for (const { rel, abs } of targets) {
        let link = false;
        try { link = lstatSync(abs).isSymbolicLink(); } catch { /* gone */ }
        if (link) throw new Error(`${rel} is a symlink, not the file the pack installed; move it aside first`);
      }
      for (const { rel, abs } of targets) {
        try { snapshot[rel] = readFileSync(abs); } catch (err) {
          // Gone is nothing to restore; a file that exists but cannot be read could not be put back.
          if (err?.code !== 'ENOENT') unreadable.push(`${rel}: ${err.message}`);
        }
      }
      if (unreadable.length) throw new Error(`cannot back up the installed pack, so nothing was replaced:\n  ${unreadable.join('\n  ')}`);
      const gone = deleteLockedFiles(root, id, previous);
      if (gone.failed.length) {
        restoreFiles(root, snapshot);
        throw new Error(`could not replace the installed pack:\n  ${gone.failed.map((f) => `${f.rel}: ${f.message}`).join('\n  ')}`);
      }
    }

    const written = [];
    try {
      mkdirSync(dest, { recursive: true });
      const files = {};
      for (const t of pack.templates) {
        for (const kind of t.kind === 'both' ? ['cv', 'cover'] : [t.kind]) {
          const base = path.basename(t.files[kind]);
          const target = path.join(dest, base);
          copyFileSync(path.join(dir, t.files[kind]), target);
          written.push(target);
          files[`templates/${id}/${base}`] = sha256(readFileSync(target));
        }
      }
      lock.packs[id] = { repo: parsed.url, sha: pin, version: pack.version, source, files };
      writeLock(root, lock);
      return { id, version: pack.version, sha: pin, source, files: Object.keys(files) };
    } catch (err) {
      // Undo exactly what this call wrote, never a recursive delete of dest:
      // a user may have put their own file next to the pack's.
      // Every undo step runs on its own: one that throws must not skip the
      // restore, and the install error stays the one that surfaces.
      const rollbackFailures = [];
      for (const f of written) {
        try { rmSync(f, { force: true }); } catch (e) { rollbackFailures.push(`${f}: ${e.message}`); }
      }
      try { rmdirSync(dest); } catch { /* not empty, or already gone */ }
      try { restoreFiles(root, snapshot); } catch (e) { rollbackFailures.push(`restore: ${e.message}`); }
      if (rollbackFailures.length && err instanceof Error) {
        err.message += `\nrollback incomplete:\n  ${rollbackFailures.join('\n  ')}`;
        err.rollbackFailures = rollbackFailures;
      }
      throw err;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Installed packs, each with the lock-attributed files that changed or vanished. */
export function installedPacks(root) {
  return Object.entries(readLock(root).packs).map(([id, p]) => {
    const modified = Object.entries(p.files || {})
      .filter(([rel, hash]) => {
        try { return sha256(readFileSync(path.join(root, rel))) !== hash; } catch { return true; }
      })
      .map(([rel]) => rel);
    return { id, version: p.version, sha: p.sha, source: p.source, repo: p.repo, files: Object.keys(p.files || {}), modified };
  });
}

function restoreFiles(root, snapshot) {
  for (const [rel, buf] of Object.entries(snapshot)) {
    const abs = path.resolve(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
  }
}

/** A symlinked directory between root and the file would carry a read or delete outside root. */
function refuseSymlinkedAncestors(root, abs) {
  const rootAbs = path.resolve(root);
  for (let cur = path.dirname(abs); cur !== rootAbs && cur !== path.dirname(cur); cur = path.dirname(cur)) {
    let st;
    try { st = lstatSync(cur); } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw err;
    }
    if (st.isSymbolicLink()) throw new Error(`refusing to touch files through a symlinked directory: ${cur}`);
  }
}

/** Absolute, bounds-checked targets for a lock entry; throws on a path that leaves templates/<id>/. */
function lockTargets(root, id, entry) {
  const base = path.join(templatesDir(root), id);
  return Object.entries(entry.files || {}).map(([rel, hash]) => {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(base + path.sep)) throw new Error(`refusing a lock path outside templates/${id}/: ${rel}`);
    refuseSymlinkedAncestors(root, abs);
    return { rel, abs, hash };
  });
}

/** Delete a lock entry's files one by one; a failure on one does not stop the rest. */
function deleteLockedFiles(root, id, entry) {
  const removed = [];
  const failed = [];
  for (const { rel, abs } of lockTargets(root, id, entry)) {
    // lstat, not existsSync: a dangling symlink in place of a locked file reads as
    // absent through existsSync, and the copy that follows would write through it.
    let present = true;
    try { lstatSync(abs); } catch { present = false; }
    try {
      if (present) { rmSync(abs); removed.push(rel); }
    } catch (err) {
      failed.push({ rel, message: err.message });
    }
  }
  const base = path.join(templatesDir(root), id);
  try { if (existsSync(base) && readdirSync(base).length === 0) rmdirSync(base); } catch { /* keep a directory we cannot empty */ }
  return { removed, failed };
}

/** Remove exactly the files the lock attributes to a pack. */
export function removePack(root, id, { force = false } = {}) {
  // Checked before the lock is read: templates/<id>/ is the bounds every lock
  // path is held to, so an id of `..` would make the root itself that bound.
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`invalid pack id ${JSON.stringify(id)}`);
  const lock = readLock(root);
  const p = Object.hasOwn(lock.packs, id) ? lock.packs[id] : null;
  if (!p) throw new Error(`pack "${id}" is not installed`);
  const modified = lockTargets(root, id, p).filter(({ abs, hash }) => {
    // A file already gone is nothing to delete; one that exists but cannot be read
    // cannot be shown unmodified, so it needs --force like any other change.
    try { return sha256(readFileSync(abs)) !== hash; } catch (err) { return err?.code !== 'ENOENT'; }
  }).map(({ rel }) => rel);
  if (modified.length && !force) throw new Error(`these files were modified since install; pass --force to delete them:\n  ${modified.join('\n  ')}`);

  const { removed, failed } = deleteLockedFiles(root, id, p);
  if (failed.length) {
    // Keep the lock entry for what is still on disk, so a retry finishes the job.
    const left = new Set(failed.map((f) => f.rel));
    p.files = Object.fromEntries(Object.entries(p.files).filter(([rel]) => left.has(rel)));
    writeLock(root, lock);
    throw new Error(`could not remove ${failed.length} file(s) of "${id}"; the rest were removed:\n  ${failed.map((f) => `${f.rel}: ${f.message}`).join('\n  ')}`);
  }
  delete lock.packs[id];
  writeLock(root, lock);
  return { id, removed };
}
