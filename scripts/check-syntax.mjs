#!/usr/bin/env node
/**
 * check-syntax.mjs — zero-dependency syntax linter for repository scripts.
 *
 * Runs `node --check` on every repository .mjs file. Generated data and
 * dependency directories are excluded so the result is deterministic on a
 * clean checkout and useful locally before dependencies are installed.
 */

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectMjsFiles } from '../lib/mjs-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The walk (and the list of directories it skips) lives in lib/mjs-files.mjs
// so that this linter and test-all.mjs's syntax gate cannot disagree about
// which files exist — see that module's header for what happened when they
// did (#3419).
const files = collectMjsFiles(root);
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
