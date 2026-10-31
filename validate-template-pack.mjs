#!/usr/bin/env node
// @ts-check
// validate-template-pack.mjs — structural gate for a template pack: a
// directory with a pack.json and the templates it declares (#5949, #1778).
//
// It invents no template policy. Placeholders come from validateTemplate, the
// ATS rules from atsLint (applied only to a template that claims `ats: true`),
// and the render rules from renderLint, where every finding fails the pack: a
// pack that needs a script or a remote asset is not a template pack. Design
// conventions beyond these (accent contrast, font floors) belong to the pack's
// own authoring guide and CI.
//
// Nothing in the pack is executed; files are read as text.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { atsLint, renderLint, validateTemplate } from './cv-templates.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const NAME_PREFIX = 'career-ops-template-';
const KINDS = new Set(['cv', 'cover', 'both']);
const ATS_RISKS = new Set(['none', 'design-forward']);
const FILE_PREFIX = { cv: 'cv-template', cover: 'cover-letter-template' };

const isText = (v) => typeof v === 'string' && v.trim() !== '';

// A `..` segment is refused as written when it resolves back inside the pack
// (#5949); one that leaves the pack is reported as outside it: a declared path names its file directly. Both separators count,
// since a pack can be validated on Windows.
const hasDotDot = (rel) => isText(rel) && rel.split(/[\\/]/).includes('..');

/** Absolute path of `rel` when it stays inside `root`, else null. */
function inside(root, rel) {
  if (!isText(rel) || path.isAbsolute(rel)) return null;
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/** True when the real path of an existing file is still inside the real pack root. */
function realInside(realRoot, abs) {
  try {
    return realpathSync(abs).startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

/**
 * Validate a pack directory.
 * @param {string} dir Directory holding pack.json.
 * @returns {string[]} problems (empty = valid)
 */
export function validatePack(dir) {
  const root = path.resolve(dir);
  const manifestPath = path.join(root, 'pack.json');
  let pack;
  try {
    pack = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return [`pack.json unreadable or invalid JSON: ${err.message}`];
  }
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return ['pack.json is not a JSON object'];

  const problems = [];
  let realRoot = root;
  try { realRoot = realpathSync(root); } catch { /* reported by the file checks */ }

  if (pack.packVersion !== 1) problems.push(`unsupported packVersion ${JSON.stringify(pack.packVersion)} (expected 1)`);
  // typeof first: RegExp.test coerces, so ["demo"] and 123 would pass the id check.
  if (typeof pack.id !== 'string' || !ID_RE.test(pack.id)) problems.push(`invalid pack id ${JSON.stringify(pack.id)} (must match ${ID_RE})`);
  if (pack.name !== NAME_PREFIX + pack.id) problems.push(`pack name must equal "${NAME_PREFIX}${pack.id}" (got ${JSON.stringify(pack.name)})`);
  for (const field of ['displayName', 'description', 'author', 'license', 'version']) {
    if (!isText(pack[field])) problems.push(`missing or empty pack field: ${field}`);
  }
  if (!Array.isArray(pack.templates) || pack.templates.length === 0) {
    problems.push('templates must be a non-empty array');
    return problems;
  }

  const ids = new Set();
  for (const entry of pack.templates) {
    const eid = (entry && entry.id) || '?';
    if (!entry || typeof entry !== 'object') { problems.push(`${eid}: template entry is not an object`); continue; }
    if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) problems.push(`${eid}: invalid template id`);
    if (ids.has(entry.id)) problems.push(`duplicate template id: ${entry.id}`);
    ids.add(entry.id);
    if (!isText(entry.displayName)) problems.push(`${eid}: missing or empty displayName`);
    if (!KINDS.has(entry.kind)) problems.push(`${eid}: invalid kind ${JSON.stringify(entry.kind)} (cv|cover|both)`);
    if (typeof entry.ats !== 'boolean') problems.push(`${eid}: ats must be a boolean`);
    if (!ATS_RISKS.has(entry.atsRisk)) problems.push(`${eid}: invalid atsRisk ${JSON.stringify(entry.atsRisk)} (none|design-forward)`);
    if (entry.atsRisk === 'design-forward' && !isText(entry.atsRiskNote)) problems.push(`${eid}: atsRiskNote is required when atsRisk is "design-forward"`);

    const kinds = entry.kind === 'both' ? ['cv', 'cover'] : KINDS.has(entry.kind) ? [entry.kind] : [];
    const files = entry.files || {};
    const previews = entry.previews || {};
    for (const kind of kinds) {
      const rel = files[kind];
      if (!isText(rel)) {
        problems.push(`${eid}: files.${kind} missing`);
      } else {
        const abs = inside(root, rel);
        const expected = `${FILE_PREFIX[kind]}.${entry.id}.html`;
        if (!abs) problems.push(`${eid}: files.${kind} "${rel}" is outside the pack`);
        else if (hasDotDot(rel)) problems.push(`${eid}: files.${kind} "${rel}" contains a \`..\` segment`);
        else if (path.basename(rel) !== expected) problems.push(`${eid}: files.${kind} "${rel}" does not match the filename convention "${expected}"`);
        else if (!existsSync(abs) || !statSync(abs).isFile()) problems.push(`${eid}: files.${kind} "${rel}": missing file (not found on disk)`);
        else if (!realInside(realRoot, abs)) problems.push(`${eid}: files.${kind} "${rel}" is outside the pack (symlink)`);
        else problems.push(...lintTemplate(abs, kind, entry, `${eid}: ${rel}`));
      }

      const prel = previews[kind];
      const pabs = inside(root, prel);
      if (!isText(prel)) problems.push(`${eid}: previews.${kind} missing`);
      else if (!pabs) problems.push(`${eid}: previews.${kind} "${prel}" is outside the pack`);
      else if (hasDotDot(prel)) problems.push(`${eid}: previews.${kind} "${prel}" contains a \`..\` segment`);
      else if (!existsSync(pabs)) problems.push(`${eid}: previews.${kind} "${prel}" not found on disk`);
      else if (!statSync(pabs).isFile()) problems.push(`${eid}: previews.${kind} "${prel}" is not a file`);
      else if (!realInside(realRoot, pabs)) problems.push(`${eid}: previews.${kind} "${prel}" is outside the pack (symlink)`);
    }
  }
  return problems;
}

function lintTemplate(abs, kind, entry, where) {
  const problems = [];
  const { missing } = validateTemplate(abs, kind);
  for (const ph of missing) problems.push(`${where}: missing placeholder {{${ph}}}`);
  const render = renderLint(abs);
  if (render.error) problems.push(`${where}: render check could not read the file: ${render.error}`);
  for (const f of render.findings) problems.push(`${where}: ${f.id}: ${f.detail}`);
  if (entry.ats === true) {
    const ats = atsLint(abs, kind);
    if (ats.error) problems.push(`${where}: ATS check could not run: ${ats.error}`);
    for (const f of ats.findings) problems.push(`${where}: ${f.id}: ${f.detail}`);
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const usage = 'Usage: node validate-template-pack.mjs <pack-dir>\n';
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage}\nStructural gate for a template pack (pack.json plus the templates it declares).\nExits 0 when valid, 1 with one line per problem, 2 on bad usage. Nothing in the pack is executed.\n`);
    process.exit(0);
  }
  const dir = argv.find((a) => !a.startsWith('-'));
  if (!dir) { process.stderr.write(usage); process.exit(2); }
  const problems = validatePack(dir);
  // Problems quote pack-controlled strings; escape control characters so a
  // newline or escape sequence cannot forge output lines or drive the terminal.
  const safe = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  if (problems.length) { for (const p of problems) console.error(`✗ ${safe(p)}`); process.exit(1); }
  console.log(`✓ template pack is valid (${path.resolve(dir)})`);
  process.exit(0);
}
