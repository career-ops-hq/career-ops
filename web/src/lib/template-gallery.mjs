import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { patchProfileText } from "./profile-yaml-edit.mjs";
import { SAMPLE_CV_PAYLOAD, SAMPLE_COVER_PAYLOAD } from "./template-sample-resume.mjs";

// The Templates gallery on /config (#1692). Which templates exist, which one a
// name resolves to and what a template looks like filled all stay the core's:
// cv-templates.mjs lists and resolves, build-cv-html.mjs renders. Reimplementing
// any of that here would be a second lookup that drifts from the CLI's, so this
// module only calls them and writes the one profile key the CLI already reads
// (cv.template or cover_letter.template).

const BASE_TEMPLATE = "standard";
const PREVIEW_TIMEOUT_MS = 20_000;

/** @param {string} root absolute path to the career-ops checkout */
async function loadResolver(root) {
  return import(/* webpackIgnore: true */ pathToFileURL(path.join(root, "cv-templates.mjs")).href);
}

/** Profile section holding `template` for each kind: the keys the CLI reads (KINDS in cv-templates.mjs). */
const PROFILE_SECTION = { cv: "cv", cover: "cover_letter" };

/** @param {string} kind */
function assertKind(kind) {
  if (!Object.hasOwn(PROFILE_SECTION, kind)) throw new Error(`Unknown template kind: ${String(kind).slice(0, 20)}`);
}

/**
 * The kind a request names, or null. A missing value is not a kind.
 * @param {unknown} value
 * @returns {"cv"|"cover"|null}
 */
export function parseKind(value) {
  return value === "cv" || value === "cover" ? value : null;
}

/**
 * @param {string} root
 * @param {"cv"|"cover"} kind
 * @param {{profilePath?: string}} [opts] profilePath: the profile the CLI would read
 * @returns {Promise<{templates: {name: string, displayName: string, isDefault: boolean}[], defaultName: string}>}
 */
export async function listTemplatesOfKind(root, kind, { profilePath } = {}) {
  assertKind(kind);
  const resolver = await loadResolver(root);
  const listed = resolver.listTemplates(kind);
  const configured = resolver.loadProfileDefault(kind, profilePath ? { profilePath } : {});
  const wanted = configured ? resolver.kebab(configured) : BASE_TEMPLATE;
  // A profile naming a template that is gone resolves to the base template on
  // the CLI (fallback), so that is what the gallery must show as the default.
  const defaultName = listed.some((t) => t.name === wanted) ? wanted : BASE_TEMPLATE;
  return {
    templates: listed.map((t) => ({ name: t.name, displayName: t.displayName, isDefault: t.name === defaultName })),
    defaultName,
  };
}

/** @param {string} root @param {{profilePath?: string}} [opts] */
export const listCvTemplates = (root, opts) => listTemplatesOfKind(root, "cv", opts);

/**
 * Resolve `name` through the core, which throws for a name it does not list and
 * for a template whose required placeholders or declared sections are missing.
 * Returns the template's absolute path.
 * @param {string} root
 * @param {string} name
 * @param {"cv"|"cover"} [kind]
 */
export async function assertSelectableTemplate(root, name, kind = "cv") {
  assertKind(kind);
  const resolver = await loadResolver(root);
  const listed = resolver.listTemplates(kind);
  if (typeof name !== "string" || !listed.some((t) => t.name === name)) {
    throw new Error(`Template not found: ${String(name).slice(0, 80)}`);
  }
  return resolver.resolveTemplate(kind, name);
}

/**
 * The line edit, or a full dump when the file's shape defeats it. A dump drops
 * every comment, so a profile that has comments and a shape the line edit cannot
 * place (a flow mapping such as `cv: { template: x }`) is refused instead.
 * @param {string} source
 * @param {Record<string, Record<string, string>>} patch
 * @param {unknown} merged
 */
function editProfile(source, patch, merged) {
  const edited = patchProfileText(source, patch, merged);
  if (edited !== null) return edited;
  if (/(^|\s)#/m.test(source)) {
    throw new Error(
      "config/profile.yml has comments and a layout this edit cannot place without dropping them (for example cv written as { template: ... }). Set the template in the file by hand, or write that section as an indented block.",
    );
  }
  return yaml.dump(merged, { lineWidth: 100, noRefs: true });
}

/**
 * profile.yml text with the kind's template key set to `name`, every other line untouched.
 * @param {string} source current profile text
 * @param {"cv"|"cover"} kind
 * @param {string} name
 */
export function profileWithTemplate(source, kind, name) {
  assertKind(kind);
  const section = PROFILE_SECTION[kind];
  const doc = yaml.load(source) ?? {};
  if (!isMapping(doc)) throw new Error("config/profile.yml is not a mapping of settings; refusing to rewrite it.");
  if (doc[section] !== undefined && doc[section] !== null && !isMapping(doc[section])) {
    throw new Error(`config/profile.yml has a ${section} entry that is not a mapping; refusing to rewrite it.`);
  }
  const merged = { ...doc, [section]: { ...(doc[section] ?? {}), template: name } };
  return editProfile(source, { [section]: { template: name } }, merged);
}

/** @param {string} source @param {string} name */
export const profileWithCvTemplate = (source, name) => profileWithTemplate(source, "cv", name);

/**
 * The named template filled with the fictional sample, as an HTML page. A CV goes
 * through build-cv-html.mjs; a cover letter through generate-cover-letter.mjs's
 * buildHtml, the pure half of that script (no Playwright, nothing written).
 * @param {string} root
 * @param {string} name
 * @param {"cv"|"cover"} [kind]
 * @returns {Promise<string>}
 */
export async function renderTemplatePreview(root, name, kind = "cv") {
  const templatePath = await assertSelectableTemplate(root, name, kind);
  if (kind === "cover") {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(path.join(root, "generate-cover-letter.mjs")).href);
    return mod.buildHtml(structuredClone(SAMPLE_COVER_PAYLOAD), templatePath);
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "template-preview-"));
  try {
    const input = path.join(dir, "payload.json");
    const output = path.join(dir, "preview.html");
    await fs.writeFile(input, JSON.stringify(SAMPLE_CV_PAYLOAD));
    await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(root, "build-cv-html.mjs"), input, output, templatePath],
        { cwd: root, timeout: PREVIEW_TIMEOUT_MS, windowsHide: true },
        (err, _out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(undefined)),
      );
    });
    return await fs.readFile(output, "utf8");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/**
 * The page with a CSP of its own. The preview is shown as an iframe srcdoc, and a
 * srcdoc document takes its parent's policy, not the headers of the response it
 * was fetched from, so the policy has to travel inside the page.
 * @param {string} html
 */
export function withPreviewCsp(html) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  // Skip comments, which a template may fill with markup, and match <head> as a
  // whole tag name so <header> is not taken for it.
  const tokens = /<!--[\s\S]*?-->|<head(?=[\s>])[^>]*>/gi;
  let match;
  while ((match = tokens.exec(html))) {
    if (match[0].startsWith("<!--")) continue;
    const end = match.index + match[0].length;
    return html.slice(0, end) + meta + html.slice(end);
  }
  return meta + html;
}

/** @param {unknown} v */
function isMapping(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
