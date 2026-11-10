#!/usr/bin/env node
// @ts-check
// validate-template-registry.mjs — deterministic shape gate for the template
// pack registry (templates-registry/<id>.json, one file per pack). Run locally
// and by the template-registry-validate CI. Shape and uniqueness only: no
// network, and no pack content is read.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, loadRegistryFiles, validateRegistryEntry } from './lib/templates-registry.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** @returns {string[]} problems (empty = valid) */
export function validateRegistry(root) {
  const problems = [];
  // Per-pack-file invariants: every file parses to an object, and the filename
  // equals the entry's id. The filename IS the conflict-free uniqueness
  // guarantee: two packs cannot claim one id without touching the same file.
  for (const { file, entry } of loadRegistryFiles(root)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${file}: not a JSON object`); continue; }
    if (entry.id && `${entry.id}.json` !== file) problems.push(`${file}: filename must equal "<id>.json" (id is "${entry.id}")`);
  }
  const names = new Set();
  const ids = new Set();
  for (const e of loadRegistry(root).packs) {
    for (const er of validateRegistryEntry(e, { idRe: ID_RE })) problems.push(`${e.name || e.id || '?'}: ${er}`);
    if (e.name && names.has(e.name)) problems.push(`duplicate name: ${e.name}`);
    if (e.id && ids.has(e.id)) problems.push(`duplicate id: ${e.id}`);
    names.add(e.name);
    ids.add(e.id);
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      'Usage: node validate-template-registry.mjs [--root <dir>]',
      '',
      'Shape gate for templates-registry/<id>.json. Exits 0 when every entry is valid,',
      '1 with one line per problem otherwise. No network; no pack content is read.',
      '',
    ].join('\n'));
    process.exit(0);
  }
  const i = argv.indexOf('--root');
  if (i >= 0 && (!argv[i + 1] || argv[i + 1].startsWith('-'))) {
    process.stderr.write('Usage: node validate-template-registry.mjs [--root <dir>]\n--root needs a directory\n');
    process.exit(2);
  }
  const root = i >= 0 ? path.resolve(argv[i + 1]) : DEFAULT_ROOT;
  const problems = validateRegistry(root);
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log('✓ template registry is valid');
  process.exit(0);
}
