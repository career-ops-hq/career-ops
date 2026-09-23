#!/usr/bin/env node
// cv-templates.mjs — discover, resolve, and validate CV / cover-letter templates.
// Single source of truth for "which template file, and is it usable?".
// Backward-compatible: with no config and no named files, resolves the base
// templates/cv-template.html (name "standard"), identical to prior behavior.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { isMainModule } from './lib/is-main-module.mjs';
import { auditAts } from './verify-ats.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES_DIR = resolve(__dirname, 'templates');
const DEFAULT_PROFILE_PATH =
  process.env.CAREER_OPS_PROFILE || resolve(__dirname, 'config', 'profile.yml');

export const KINDS = {
  cv: {
    prefix: 'cv-template',
    profileKey: ['cv', 'template'],
    required: ['NAME', 'EXPERIENCE', 'EDUCATION'],
  },
  cover: {
    prefix: 'cover-letter-template',
    profileKey: ['cover_letter', 'template'],
    required: ['NAME', 'ROLE_TITLE', 'OPENING'],
  },
};

export function prettify(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function kebab(display) {
  return String(display)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The only template formats the resolver recognizes. `format` reaches path
// construction (fileFor) unmodified, so it must be allowlisted or a value like
// `--format=../../etc/passwd` would traverse out of the templates dir.
const VALID_FORMATS = new Set(['html', 'tex']);
function assertFormat(format) {
  if (!VALID_FORMATS.has(format)) {
    throw new Error(`Unsupported template format: ${format} (expected html or tex)`);
  }
}

// filename → {name, format} | null. Base "cv-template.html" → name "standard";
// "cv-template.<name>.html" → that name. Only html/tex are recognized.
function parseFilename(prefix, file) {
  const m = file.match(new RegExp(`^${prefix}(?:\\.([a-z0-9-]+))?\\.(html|tex)$`));
  if (!m) return null;
  return { name: m[1] || 'standard', format: m[2] };
}

export function parseMeta(path) {
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return {};
  }
  const block = text.match(/<!--\s*career-ops-template\s*([\s\S]*?)-->/);
  if (!block) return {};
  const meta = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2];
  }
  return meta;
}

// Build the entry a discovered template file contributes.
function entryFor(parsed, path, pack) {
  const meta = parseMeta(path);
  return {
    name: parsed.name,
    displayName: meta.name || prettify(parsed.name),
    path,
    format: parsed.format,
    meta,
    pack,
  };
}

// Discover every template of `kind`/`format` under `dir`: the flat files that
// have always lived there, plus one level of *template packs* (#3202).
//
// A pack is a subdirectory holding its own `<prefix>.<name>.<format>` next to
// its own `sections/`. That co-location is the whole point: build-cv-html.mjs
// resolves partials relative to the template file, so a pack gets its own DOM
// without touching the `sections/` every flat template shares.
//
// The template name comes from the *filename*, exactly as it does for a flat
// template — never from the directory name. `templates/ats/cv-template.ats.html`
// is template "ats" because of the file, and the directory could be called
// anything. That keeps one naming rule instead of two.
//
// Packs are one level deep only. Nothing here recurses: a pack's `sections/`
// must not be mistaken for a nested pack, and an arbitrarily deep walk over a
// user-writable directory is a cost (and a surface) with no use case behind it.
//
// Symlinked directories are followed, which needs an explicit stat because
// `Dirent.isDirectory()` is false for a symlink.
//
// Refusing them looks like the safer default and isn't. A symlink grants no
// capability its creator lacked: anyone who can drop `templates/mine` as a link
// can drop it as a real directory holding the same file, so skipping buys no
// protection against a hostile template — it only makes a legitimate one
// vanish. The repo's actual symlink guards are on a different axis, and both
// stay intact: resolveInsideRepo() in reconcile-pipeline.mjs resolves
// user-supplied path *arguments* before a boundary check, and contacts.mjs
// refuses to *write* through a link escaping the project. Discovery does
// neither — it enumerates a directory the project owns and only ever reads.
//
// Cycles are not a concern precisely because this walk is one level and never
// recurses; a link pointing at its own ancestor is read once as a directory
// and contributes whatever template files sit at its top level.
//
// The deciding cost is silent invisibility. career-ops sanctions a symlinked
// user layer (#524), so a pack maintained outside the repo is a supported
// setup, and skipping it would drop the template from the registry with
// nothing said — the same failure this file refuses to accept for name
// collisions.
//
// Returns Map<name, entry>. A name claimed twice throws — see assertNoCollision.
function discover(kind, { dir, format }) {
  const cfg = KINDS[kind];
  const found = new Map();
  if (!existsSync(dir)) return found;

  const claim = (parsed, path, pack) => {
    if (parsed.format !== format) return;
    const prior = found.get(parsed.name);
    if (prior) assertNoCollision(parsed.name, prior.path, path, dir);
    found.set(parsed.name, entryFor(parsed, path, pack));
  };

  // One listing serves both passes. Reading twice would let the flat pass and
  // the pack pass see different directory states, and the collision check spans
  // them: a file present for one read and gone for the other decides whether a
  // name is ambiguous. A single snapshot makes that verdict reproducible.
  const top = readdirSync(dir, { withFileTypes: true });

  // Flat templates. Unchanged from before packs existed, including the fact
  // that a symlinked file is read through like any other.
  for (const d of top) {
    const parsed = parseFilename(cfg.prefix, d.name);
    if (parsed) claim(parsed, resolve(dir, d.name), null);
  }

  // Packs, one level down.
  for (const d of top) {
    const packDir = resolve(dir, d.name);
    if (!d.isDirectory()) {
      // statSync follows the link; it throws on a broken one, which is not a pack.
      if (!d.isSymbolicLink()) continue;
      try {
        if (!statSync(packDir).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    let inner;
    try {
      inner = readdirSync(packDir);
    } catch {
      continue; // unreadable directory is not a pack
    }
    for (const file of inner) {
      const parsed = parseFilename(cfg.prefix, file);
      if (parsed) claim(parsed, resolve(packDir, file), d.name);
    }
  }

  return found;
}

// A template name resolves to exactly one file, enforced when it is discovered
// rather than settled by a precedence rule.
//
// Precedence would have to pick a winner while both files exist and both look
// correct — during a migration from a flat template to a pack, say — and the
// loser would simply stop being rendered, silently, with nothing in the output
// naming the file that won. Failing at discovery costs one clear error and
// makes the ambiguity impossible to ship past.
function assertNoCollision(name, a, b, dir) {
  const rel = (p) => p.slice(dir.length + 1) || p;
  const [x, y] = [rel(a), rel(b)].sort();
  throw new Error(
    `Template name "${name}" is claimed by two files: ${x} and ${y}. `
      + `A name must resolve to one template — rename one, or remove the one you no longer use.`
  );
}

export function listTemplates(kind, { dir = DEFAULT_TEMPLATES_DIR, format = 'html' } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  assertFormat(format);
  return [...discover(kind, { dir, format }).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function validateTemplate(path, kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  const text = readFileSync(path, 'utf-8');
  const missing = cfg.required.filter((ph) => !text.includes(`{{${ph}}}`));
  return { ok: missing.length === 0, missing };
}

export function loadProfileDefault(kind, { profilePath = DEFAULT_PROFILE_PATH } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  if (!existsSync(profilePath)) return null;
  let doc;
  try {
    doc = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    return null;
  }
  let node = doc;
  for (const key of cfg.profileKey) node = node?.[key];
  return typeof node === 'string' && node.trim() ? node.trim() : null;
}

export function resolveTemplate(kind, name, opts = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  const {
    dir = DEFAULT_TEMPLATES_DIR,
    format = 'html',
    profilePath = DEFAULT_PROFILE_PATH,
    fallback = false,
  } = opts;
  assertFormat(format);

  const explicit = Boolean(name && String(name).trim());
  let chosen = kebab(explicit ? name : loadProfileDefault(kind, { profilePath }) || 'standard');
  const fileFor = (n) => (n === 'standard' ? `${cfg.prefix}.${format}` : `${cfg.prefix}.${n}.${format}`);

  // Resolution goes through the same discovery as listTemplates, so a name that
  // lists is a name that resolves. Constructing `dir/fileFor(chosen)` directly
  // would find flat templates only: a pack would list fine and then throw here,
  // which is the failure mode that passes review because the demo path works.
  // Every by-name caller lands here — build-cv-latex.mjs, generate-cover-letter.mjs.
  const found = discover(kind, { dir, format });

  let entry = found.get(chosen);
  if (!entry && fallback && chosen !== 'standard') {
    chosen = 'standard';
    entry = found.get(chosen);
  }
  if (!entry) {
    throw new Error(`Template not found for kind=${kind} name=${chosen} (${fileFor(chosen)})`);
  }
  const path = entry.path;
  if (format === 'html') {
    const v = validateTemplate(path, kind);
    if (!v.ok) {
      // Name the file that is actually short, not the flat filename it would
      // have had. For a pack these differ, and the flat name points at nothing.
      const where = entry.pack ? `${entry.pack}/${fileFor(chosen)}` : fileFor(chosen);
      throw new Error(
        `Template ${where} missing required placeholders: ${v.missing.map((m) => `{{${m}}}`).join(', ')}`
      );
    }
  }
  return path;
}

// ---- CLI ----
const DEFAULT_ATS_RULES_PATH = resolve(__dirname, 'templates', 'ats-rules.yml');

let _atsRules = null;

/**
 * The ATS rule contract, from templates/ats-rules.yml.
 *
 * Cached: the file is read once per process. Tests that point at a different
 * rules file pass `rulesPath`, which bypasses the cache.
 *
 * @param {string} [rulesPath]
 * @returns {{id:string, rule:string, applies_to:string[], severity:string,
 *            detect:string|null, must_not_flag?:string,
 *            not_template_reason?:string, open?:string}[]}
 */
export function loadAtsRules(rulesPath = DEFAULT_ATS_RULES_PATH) {
  if (rulesPath === DEFAULT_ATS_RULES_PATH && _atsRules) return _atsRules;
  const doc = yaml.load(readFileSync(rulesPath, 'utf-8')) || {};
  const rules = Array.isArray(doc.rules) ? doc.rules : [];
  if (rulesPath === DEFAULT_ATS_RULES_PATH) _atsRules = rules;
  return rules;
}

/**
 * Check a TEMPLATE against the ATS rules the project already states.
 *
 * This is deliberately not a second ATS implementation. Detection is
 * `auditAts` (verify-ats.mjs); what this adds is the part `auditAts` cannot
 * know — that its input is a template rather than a CV.
 *
 * A template carries {{PLACEHOLDERS}} where content will be, so every
 * content-dependent check has no answer yet. Run unfiltered against the eight
 * shipped templates, `auditAts` reports a critical "No email address found" on
 * all eight, because `{{EMAIL}}` is not an email address. A lint that fires on
 * the project's own templates is worse than no lint: it teaches people to
 * ignore it. So rules marked `applies_to: [rendered]` are SKIPPED and reported
 * as skipped — never silently dropped, and never counted as passes.
 *
 * Never throws for a lint result: a finding is data, and the caller chooses
 * severity. It does throw for an unusable input (unknown kind, unreadable
 * file), which is a programming error rather than a lint verdict.
 *
 * @param {string} path Template file to check.
 * @param {string} kind 'cv' or 'cover'.
 * @param {{rulesPath?: string}} [opts]
 * @returns {{findings: {id:string, severity:string, message:string, rule:string, mustNotFlag:string|null}[],
 *            skipped: {id:string, reason:string}[],
 *            gaps: {id:string, rule:string, note:string}[]}}
 */
export function atsLint(path, kind, { rulesPath } = {}) {
  if (!KINDS[kind]) throw new Error(`Unknown template kind: ${kind}`);
  const html = readFileSync(path, 'utf-8');
  const rules = loadAtsRules(rulesPath);
  const byId = new Map(rules.map((r) => [r.id, r]));

  const findings = [];
  const skipped = [];
  for (const issue of auditAts(html).issues) {
    const rule = byId.get(issue.id);
    // An issue with no rule entry is a rule that exists in code and not in the
    // contract. Surfacing it is the point — silently passing it through would
    // let the two drift, which is the failure this file was written to prevent.
    if (!rule) {
      findings.push({
        id: issue.id,
        severity: issue.severity,
        message: issue.message,
        rule: `(not in ${rulesPath || 'templates/ats-rules.yml'})`,
        mustNotFlag: null,
      });
      continue;
    }
    // A rule scoped to other kinds is not about this template at all. Unlike a
    // rendered-only skip, there is nothing deferred here, so it is not reported
    // as skipped either — it simply does not apply.
    if (Array.isArray(rule.kinds) && !rule.kinds.includes(kind)) continue;
    if (!rule.applies_to.includes('template')) {
      skipped.push({ id: issue.id, reason: rule.not_template_reason || 'Not meaningful on an unrendered template.' });
      continue;
    }
    findings.push({
      id: issue.id,
      severity: rule.severity || issue.severity,
      message: issue.message,
      rule: rule.rule,
      mustNotFlag: rule.must_not_flag || null,
    });
  }

  // Rules the project holds and does not yet check. Reported on every run so a
  // clean result cannot be mistaken for a complete one.
  const gaps = rules
    .filter((r) => !r.detect)
    .map((r) => ({ id: r.id, rule: r.rule, note: r.open || '' }));

  return { findings, skipped, gaps };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const kind = argv[1];
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const positionals = argv.slice(2).filter((a) => !a.startsWith('--'));
  const format = flags.format || 'html';
  try {
    if (cmd === 'list') {
      const items = listTemplates(kind, { format }).map(({ name, displayName }) => ({ name, displayName }));
      process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    } else if (cmd === 'resolve') {
      const name = positionals[0];
      process.stdout.write(resolveTemplate(kind, name, { format, fallback: Boolean(flags.fallback) }) + '\n');
    } else {
      process.stderr.write('Usage: node cv-templates.mjs <list|resolve> <cv|cover> [name] [--format=html|tex] [--fallback]\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
