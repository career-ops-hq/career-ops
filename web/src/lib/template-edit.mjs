import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TemplateRefusal, refusalFrom } from "./template-refusal.mjs";

// Editing the body of one of the user's own templates (#1692). Whether the result
// is usable stays the core's call: the candidate text is put where the resolver
// can read it, beside the template's own sections, and resolveTemplate() accepts
// or rejects it exactly as it will at render time. Nothing is written here; the
// route writes the checked text through the shared atomic writer.

export const MAX_TEMPLATE_BYTES = 512 * 1024;

/** @param {string} root */
async function loadResolver(root) {
  return import(/* webpackIgnore: true */ pathToFileURL(path.join(root, "cv-templates.mjs")).href);
}

/** @param {string} text */
const versionOf = (text) => createHash("sha256").update(text).digest("hex");

/** @param {any} resolver @param {string} kind @param {string} userDir @param {string} name */
function userEntry(resolver, kind, userDir, name) {
  const entry = resolver.listTemplates(kind, { userDir }).find((t) => t.name === name);
  if (!entry) throw new TemplateRefusal(`Template not found: ${String(name).slice(0, 80)}`, 404);
  if (entry.layer !== "user") throw new TemplateRefusal("Only your own templates can be edited. Duplicate this one first.");
  return entry;
}

/**
 * The text of one of the user's own templates, and a version to send back with the edit.
 * @param {string} root core checkout
 * @param {{kind: "cv"|"cover", name: string, userDir: string}} opts
 */
export async function readUserTemplate(root, { kind, name, userDir }) {
  const entry = userEntry(await loadResolver(root), kind, userDir, name);
  const text = await fs.readFile(entry.path, "utf8");
  return { text, version: versionOf(text) };
}

/**
 * Check an edit before it is written. Throws, with nothing changed, when the text
 * is too large or binary, when the file moved on since `version` was read, or when
 * the edited template would no longer resolve (missing required placeholders, a
 * declared section with no partial). Returns the path to write and the new version.
 * @param {string} root
 * @param {{kind: "cv"|"cover", name: string, text: string, version: string, userDir: string}} opts
 */
export async function checkTemplateEdit(root, { kind, name, text, version, userDir }) {
  if (typeof text !== "string") throw new TemplateRefusal("The template text is missing.");
  if (Buffer.byteLength(text) > MAX_TEMPLATE_BYTES) throw new TemplateRefusal(`The template is too large (limit ${MAX_TEMPLATE_BYTES / 1024} KB).`);
  if (text.includes("\0")) throw new TemplateRefusal("The template contains a NUL byte; it looks binary, not HTML.");

  const resolver = await loadResolver(root);
  const entry = userEntry(resolver, kind, userDir, name);
  const current = await fs.readFile(entry.path, "utf8");
  if (versionOf(current) !== version) {
    throw new TemplateRefusal("This template changed since you opened it. Reload it, then apply your edit again.", 409);
  }

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "template-edit-"));
  try {
    await fs.writeFile(path.join(scratch, path.basename(entry.path)), text);
    await fs.cp(path.join(path.dirname(entry.path), "sections"), path.join(scratch, "sections"), { recursive: true }).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    // userDir: null keeps the user layer out, so the scratch copy is the whole registry.
    try {
      resolver.resolveTemplate(kind, name, { dir: scratch, userDir: null });
    } catch (e) {
      throw refusalFrom(e);
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  return { path: entry.path, version: versionOf(text) };
}

/**
 * Synchronous, so the caller can compare and write with no await between them:
 * checkTemplateEdit awaits scratch-directory work after it compares, and a second
 * save carrying the same version could otherwise pass and overwrite the first.
 * @param {string} file the template path checkTemplateEdit returned
 * @param {string} version the version the edit was made against
 */
export function assertVersionUnchanged(file, version) {
  if (versionOf(readFileSync(file, "utf8")) !== version) {
    throw new TemplateRefusal("This template changed since you opened it. Reload it, then apply your edit again.", 409);
  }
}
