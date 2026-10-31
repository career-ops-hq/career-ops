import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TemplateRefusal, refusalFrom } from "./template-refusal.mjs";

// Duplicate, rename and delete of the user's own templates (#1692). They live in
// data/templates/ under the data root, the directory cv-templates.mjs searches
// for the user layer (#5777), so the updater never touches them. Which templates
// exist and whether one still resolves stay the core's; this module only moves
// files and then asks the resolver whether the result is usable.

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 40;
const BASE_NAME = "standard";

/** @param {unknown} name */
export function isValidTemplateName(name) {
  return typeof name === "string" && name.length <= MAX_NAME && name !== BASE_NAME && NAME_RE.test(name);
}

/** @param {string} root */
async function loadResolver(root) {
  return import(/* webpackIgnore: true */ pathToFileURL(path.join(root, "cv-templates.mjs")).href);
}

/** @param {string} name */
function assertValidName(name) {
  if (!isValidTemplateName(name)) {
    throw new TemplateRefusal(
      `Template name must be lowercase letters and digits joined by single hyphens, at most ${MAX_NAME} characters, and not "${BASE_NAME}".`,
    );
  }
}

/** @param {any} resolver @param {string} kind @param {string} userDir */
function listing(resolver, kind, userDir) {
  return resolver.listTemplates(kind, { userDir });
}

/**
 * @param {any} resolver @param {string} kind @param {string} userDir @param {string} name
 * @param {{ user?: boolean }} [need]
 */
function findEntry(resolver, kind, userDir, name, { user = false } = {}) {
  const entry = listing(resolver, kind, userDir).find((t) => t.name === name);
  if (!entry) throw new TemplateRefusal(`Template not found: ${String(name).slice(0, 80)}`, 404);
  if (user && entry.layer !== "user") throw new TemplateRefusal("Only your own templates can be changed. Duplicate this one first.");
  return entry;
}

/** @param {any} resolver @param {string} kind @param {string} userDir @param {string} name */
function assertNameFree(resolver, kind, userDir, name) {
  if (listing(resolver, kind, userDir).some((t) => t.name === name)) {
    throw new TemplateRefusal(`A template named "${name}" already exists.`);
  }
}

/**
 * Point the manifest header's `name:` at the new template name when it still
 * shows the old one, so two cards are not both called "Modern".
 * @param {string} text @param {string} from @param {string} to @param {(n: string) => string} prettify
 */
function retitle(text, from, to, prettify) {
  return text.replace(/(<!--\s*career-ops-template[\s\S]*?^name:[ \t]*)(.*)$/m, (all, head, shown) =>
    shown.trim() === prettify(from) ? `${head}${prettify(to)}` : all,
  );
}

/**
 * Copy a template, shipped or yours, into the user's templates directory.
 * A pack copies its template file and its sections/. A flat template copies its
 * single file.
 * @param {string} root core checkout
 * @param {{kind: "cv"|"cover", from: string, name: string, userDir: string}} opts
 */
export async function duplicateTemplate(root, { kind, from, name, userDir }) {
  assertValidName(name);
  const resolver = await loadResolver(root);
  const source = findEntry(resolver, kind, userDir, from);
  // Throws for a source that does not resolve itself (missing placeholders, a
  // declared section with no partial), so a broken template is not copied.
  try {
    resolver.resolveTemplate(kind, from, { userDir });
  } catch (e) {
    throw refusalFrom(e, "That template cannot be copied because it does not resolve: ");
  }
  assertNameFree(resolver, kind, userDir, name);

  const prefix = resolver.KINDS[kind].prefix;
  const file = `${prefix}.${name}.html`;
  const text = retitle(await fs.readFile(source.path, "utf8"), from, name, resolver.prettify);

  if (source.pack) {
    const dest = path.join(userDir, name);
    await fs.mkdir(userDir, { recursive: true });
    // Not recursive, so an existing folder under this name fails here instead of
    // being merged into, and the rollback below only ever removes what this call made.
    try {
      await fs.mkdir(dest);
    } catch (e) {
      if (e.code === "EEXIST") throw new TemplateRefusal(`A folder named "${name}" already exists in your templates.`);
      throw e;
    }
    try {
      await fs.writeFile(path.join(dest, file), text, { flag: "wx" });
      const sections = path.join(path.dirname(source.path), "sections");
      await fs.cp(sections, path.join(dest, "sections"), { recursive: true, errorOnExist: true, force: false }).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    } catch (e) {
      await fs.rm(dest, { recursive: true, force: true });
      throw e;
    }
  } else {
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, file), text, { flag: "wx" });
  }
  return { name };
}

/** @param {any} resolver @param {string} kind @param {string} userDir @param {string} profilePath */
function defaultName(resolver, kind, profilePath) {
  const configured = resolver.loadProfileDefault(kind, profilePath ? { profilePath } : {});
  return configured ? resolver.kebab(configured) : BASE_NAME;
}

/**
 * Rename one of the user's own templates. Returns whether it was the default, so
 * the caller can point the profile at the new name.
 * @param {string} root
 * @param {{kind: "cv"|"cover", name: string, to: string, userDir: string, profilePath?: string}} opts
 * @returns {Promise<{wasDefault: boolean}>}
 */
export async function renameTemplate(root, { kind, name, to, userDir, profilePath }) {
  assertValidName(to);
  const resolver = await loadResolver(root);
  const entry = findEntry(resolver, kind, userDir, name, { user: true });
  assertNameFree(resolver, kind, userDir, to);

  const prefix = resolver.KINDS[kind].prefix;
  const next = path.join(path.dirname(entry.path), `${prefix}.${to}.html`);
  const text = retitle(await fs.readFile(entry.path, "utf8"), name, to, resolver.prettify);
  await fs.writeFile(next, text, { flag: "wx" });
  await fs.rm(entry.path);
  return { wasDefault: defaultName(resolver, kind, profilePath) === name };
}

/**
 * Rename a template and, when it was the default, run `updateProfile` so the
 * profile follows. If that update fails, the file is renamed back, so the profile
 * never points at a template that is gone. The failure is a 409 refusal that
 * carries the original error as its `cause`; only the cause holds a path.
 * @param {string} root
 * @param {{kind: "cv"|"cover", name: string, to: string, userDir: string, profilePath?: string}} opts
 * @param {() => Promise<void> | void} updateProfile
 * @returns {Promise<{wasDefault: boolean}>}
 */
export async function renameTemplateAndFollow(root, opts, updateProfile) {
  const { wasDefault } = await renameTemplate(root, opts);
  if (!wasDefault) return { wasDefault };
  try {
    await updateProfile();
  } catch (cause) {
    try {
      await renameTemplate(root, { ...opts, name: opts.to, to: opts.name });
    } catch {
      throw new TemplateRefusal(`Renamed to "${opts.to}", but the profile still names "${opts.name}" and the file could not be put back.`, 409, { cause });
    }
    throw new TemplateRefusal("Nothing was renamed: the profile could not be updated.", 409, { cause });
  }
  return { wasDefault };
}

/**
 * Delete one of the user's own templates. The template the profile names as the
 * default is refused: removing it would leave the profile naming a template that
 * falls back to the base one without anyone choosing that.
 * @param {string} root
 * @param {{kind: "cv"|"cover", name: string, userDir: string, profilePath?: string}} opts
 */
export async function deleteTemplate(root, { kind, name, userDir, profilePath }) {
  const resolver = await loadResolver(root);
  const entry = findEntry(resolver, kind, userDir, name, { user: true });
  if (defaultName(resolver, kind, profilePath) === name) {
    throw new TemplateRefusal("This is your default template. Make another one the default first.");
  }
  await fs.rm(entry.path);
  const dir = path.dirname(entry.path);
  if (entry.pack && path.resolve(dir) !== path.resolve(userDir)) {
    const left = (await fs.readdir(dir)).some((f) => /^(cv-template|cover-letter-template)(\.|$)/.test(f));
    if (!left) await fs.rm(dir, { recursive: true, force: true });
  }
}
