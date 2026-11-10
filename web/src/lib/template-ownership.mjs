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
 * it passes `file: true` to check where the file really is as well.
 * @param {{path: string}} entry
 * @param {string} userDir
 * @param {{file?: boolean}} [opts]
 */
export async function assertInsideUserDir(entry, userDir, { file = false } = {}) {
  const root = await fs.realpath(userDir);
  const real = await fs.realpath(file ? entry.path : path.dirname(entry.path));
  if (!inside(real, root)) {
    throw new TemplateRefusal("This template is in a linked folder, so it is changed where it lives, not here.");
  }
}
