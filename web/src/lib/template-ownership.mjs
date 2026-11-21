import fs from "node:fs/promises";
import path from "node:path";
import { TemplateRefusal } from "./template-refusal.mjs";

// The core resolver follows a symlinked pack folder, so a template can be listed
// from a directory that lives outside the user's templates directory. Whatever
// is on the other end of that link is not the web's to change, and a delete,
// rename, cleanup or save that goes through entry.path would land there.

/** @param {string} child @param {string} parent */
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/**
 * Refuse to change a template that is not really inside the user's templates
 * directory. The folder holding it is checked by default, which is what a delete,
 * rename or its cleanup touches. A save also writes through the file itself, so
 * it passes `file: true`: the file must not be a symlink at all, and must really
 * be inside the directory.
 * @param {{path: string}} entry
 * @param {string} userDir
 * @param {{file?: boolean}} [opts]
 */
export async function assertInsideUserDir(entry, userDir, { file = false } = {}) {
  // A save replaces the file atomically, which swaps a symlink for a regular file
  // even when it points inside the user's directory: the target would never get
  // the edit and the alias would stop following it. Refuse, as for a link that
  // points outside, rather than write through it.
  if (file && (await fs.lstat(entry.path)).isSymbolicLink()) {
    throw new TemplateRefusal("This template is a link to another file, so it is changed where that file lives, not here.");
  }
  const root = await fs.realpath(userDir);
  const real = await fs.realpath(file ? entry.path : path.dirname(entry.path));
  if (!inside(real, root)) {
    throw new TemplateRefusal("This template is in a linked folder, so it is changed where it lives, not here.");
  }
}
