#!/usr/bin/env node
/**
 * check-syntax.mjs — zero-dependency syntax linter for repository scripts.
 *
 * Runs `node --check` on every repository .mjs file. Generated data and
 * dependency directories are excluded so the result is deterministic on a
 * clean checkout and useful locally before dependencies are installed.
 */

import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'output', 'data', 'coverage', 'test-results']);

function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // Symlinked directories can point outside the checkout or back into it;
    // neither should make a local lint run recurse unpredictably.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...collect(full));
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}

const files = collect(root).sort();
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${file.slice(root.length + 1)}`);
    console.error(String(err.stderr || err.message).trim());
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}

console.log(`✓ ${files.length} .mjs files passed syntax check.`);
