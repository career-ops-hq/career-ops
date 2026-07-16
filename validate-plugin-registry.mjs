#!/usr/bin/env node
// @ts-check
// validate-plugin-registry.mjs — deterministic shape gate for the plugin
// registry (plugins-registry/<id>.json, one file per plugin; legacy single-file
// plugins-registry.json still validates via the loader's fallback).
// Run locally + by the registry-validate CI. Shape/uniqueness only (no network);
// the CI additionally clones each changed entry at its pinned SHA and runs the
// min-file + manifest + audit checks in a no-secret, read-only sandbox.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, loadRegistryFiles, validateRegistryEntry } from './plugins/_registry.mjs';
import { HOOK_KINDS, RESERVED_ENV } from './plugins/_engine.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** @returns {string[]} problems (empty = valid) */
export function validateRegistry(root) {
  const reg = loadRegistry(root);
  const problems = [];
  if (reg.registryVersion !== 1) problems.push(`unsupported registryVersion ${JSON.stringify(reg.registryVersion)}`);
  // Per-plugin-file invariants: every file parses, and the filename equals the
  // entry's id — the filename IS the conflict-free uniqueness guarantee (two
  // plugins can't claim one id without touching the same file).
  for (const { file, entry } of loadRegistryFiles(root)) {
    if (!entry || typeof entry !== 'object') { problems.push(`${file}: not a JSON object`); continue; }
    if (entry.id && `${entry.id}.json` !== file) problems.push(`${file}: filename must equal "<id>.json" (id is "${entry.id}")`);
  }
  const names = new Set(), ids = new Set();
  for (const e of reg.plugins) {
    for (const er of validateRegistryEntry(e, { idRe: ID_RE, hookKinds: HOOK_KINDS, reservedEnv: RESERVED_ENV })) {
      problems.push(`${e.name || e.id || '?'}: ${er}`);
    }
    if (e.name && names.has(e.name)) problems.push(`duplicate name: ${e.name}`);
    if (e.id && ids.has(e.id)) problems.push(`duplicate id: ${e.id}`);
    // A supersedesBundled entry must name a REAL bundled plugin (anti-typo/phantom):
    // its id has to correspond to an in-tree plugins/<id>/ before it can be granted precedence.
    if (e.supersedesBundled === true && e.id && !existsSync(path.join(root, 'plugins', e.id, 'manifest.json'))) {
      problems.push(`${e.name || e.id}: supersedesBundled names "${e.id}" but no bundled plugin (plugins/${e.id}/) exists to supersede`);
    }
    names.add(e.name); ids.add(e.id);
  }
  return problems;
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  const root = process.cwd();
  const deep = process.argv.includes('--deep');
  const problems = validateRegistry(root);
  // --deep: clone each entry at its pinned SHA + statically validate it (no
  // plugin code is executed). Used by the registry-validate CI in a sandbox.
  if (deep && problems.length === 0) {
    const { auditRegistryEntry } = await import('./plugin-install.mjs');
    const { loadRegistry } = await import('./plugins/_registry.mjs');
    for (const e of loadRegistry(root).plugins) {
      for (const p of auditRegistryEntry(e.repo, e.sha, e.id)) problems.push(`${e.name}: ${p}`);
    }
  }
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`✓ plugin registry is valid${deep ? ' (deep: all entries cloned + audited)' : ''}`); process.exit(0);
}
