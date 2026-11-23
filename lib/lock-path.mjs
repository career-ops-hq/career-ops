// lib/lock-path.mjs — the real file a lock path names, so two spellings of one
// file share one lock.
//
// A lock is a sibling directory: `<file>.lock`. Two spellings of the same file
// therefore produce two different lock directories, and two processes that both
// "hold the lock" perform the read-modify-write they were serializing. Resolving
// the path first is what makes the lock name a function of the file rather than
// of how the caller wrote it down.
//
// The case that forced this (pipeline-lock, #4957/#5358): a symlink to the
// pipeline locked beside the link (`alias.md.lock`) while the real path locked
// beside the file (`pipeline.md.lock`), so two scans both wrote and one offer
// disappeared. A symlink in a parent directory already shared an inode;
// resolving the file makes the file-symlink case do the same.
//
// A file that is not there yet resolves the parent that does exist and keeps its
// own name, so a lock can be taken before the guarded file is created. A
// dangling link follows its link text until the chain ends.

import { lstatSync, readlinkSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

/**
 * Follow a chain of symbolic links on `start`, stopping at the first path that
 * is not a link (or does not exist).
 *
 * @param {string} start
 * @returns {string}
 */
function followSymlinks(start) {
  let current = start;
  const seen = new Set();
  for (let hop = 0; hop <= 16; hop++) {
    if (seen.has(current)) return current;
    seen.add(current);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (err) {
      if (err.code === 'ENOENT') return current;
      throw err;
    }
    if (!stat.isSymbolicLink()) return current;
    if (hop === 16) {
      throw new Error(`lock path has more than 16 symbolic links: ${start}`);
    }
    current = resolve(dirname(current), readlinkSync(current));
  }
  return current;
}

/**
 * The real path of the file a lock guards.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function canonicalLockPath(filePath) {
  const absolute = resolve(filePath);
  try {
    return realpathSync(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const followed = followSymlinks(absolute);
  const parent = dirname(followed);
  const name = basename(followed);
  try {
    return join(realpathSync(parent), name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return followed;
  }
}