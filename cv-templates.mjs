#!/usr/bin/env node
// cv-templates.mjs — discover, resolve, and validate CV / cover-letter templates.
// Single source of truth for "which template file, and is it usable?".
// Backward-compatible: with no config and no named files, resolves the base
// templates/cv-template.html (name "standard"), identical to prior behavior.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

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

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function scanTemplateDir(dir, cfg, format, isRoot) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    const parsed = parseFilename(cfg.prefix, file);
    if (!parsed || parsed.format !== format) continue;
    const path = resolve(dir, file);
    const meta = parseMeta(path);
    out.push({
      name: parsed.name,
      displayName: meta.name || prettify(parsed.name),
      path,
      format: parsed.format,
      meta,
      isRoot,
    });
  }
  return out;
}

export function listTemplates(kind, { dir = DEFAULT_TEMPLATES_DIR, format = 'html' } = {}) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error(`Unknown template kind: ${kind}`);
  assertFormat(format);
  const out = [];

  // Scan root templates directory
  out.push(...scanTemplateDir(dir, cfg, format, true));

  // Scan immediate subdirectories (one level only, not recursive)
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const subdir = resolve(dir, entry);
      if (!isDirectory(subdir)) continue;
      // Skip the shared sections/ directory
      if (entry === 'sections') continue;
      out.push(...scanTemplateDir(subdir, cfg, format, false));
    }
  }

  // Deduplicate by name: prefer root-level templates over packed ones
  const seen = new Map();
  for (const t of out) {
    const existing = seen.get(t.name);
    if (!existing) {
      seen.set(t.name, t);
    } else if (existing.isRoot && !t.isRoot) {
      // existing is from root dir, t is from subdir — keep existing (root preferred)
    } else if (!existing.isRoot && t.isRoot) {
      // t is from root dir, existing is from subdir — replace with root
      seen.set(t.name, t);
    }
    // If both from same level (both root or both subdirs), keep first encountered (stable)
  }

  // Strip isRoot before returning (internal only)
  return Array.from(seen.values())
    .map(({ isRoot, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name));
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

  // Prefer discovered templates (includes one-level packs)
  const discovered = listTemplates(kind, { dir, format });
  const match = discovered.find((t) => t.name === chosen);
  if (match) {
    if (format === 'html') {
      const v = validateTemplate(match.path, kind);
      if (!v.ok) {
        throw new Error(
          `Template ${match.path} missing required placeholders: ${v.missing.map((m) => `{{${m}}}`).join(', ')}`
        );
      }
    }
    return match.path;
  }

  // Fallback: construct filename directly (backward compatibility for flat templates)
  const fileFor = (n) => (n === 'standard' ? `${cfg.prefix}.${format}` : `${cfg.prefix}.${n}.${format}`);

  let path = resolve(dir, fileFor(chosen));
  if (!existsSync(path)) {
    if (fallback && chosen !== 'standard') {
      chosen = 'standard';
      path = resolve(dir, fileFor(chosen));
    }
    if (!existsSync(path)) {
      throw new Error(`Template not found for kind=${kind} name=${chosen} (${fileFor(chosen)})`);
    }
  }
  if (format === 'html') {
    const v = validateTemplate(path, kind);
    if (!v.ok) {
      throw new Error(
        `Template ${fileFor(chosen)} missing required placeholders: ${v.missing.map((m) => `{{${m}}}`).join(', ')}`
      );
    }
  }
  return path;
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
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
