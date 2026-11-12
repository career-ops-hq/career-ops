#!/usr/bin/env node
/**
 * check-syntax.mjs — zero-dependency syntax linter for repository scripts.
 *
 * Syntax-checks every repository .mjs file. Generated data and dependency
 * directories are excluded so the result is deterministic on a clean checkout
 * and useful locally before dependencies are installed.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectMjsFiles } from '../lib/mjs-files.mjs';
import { checkSyntax } from '../lib/syntax-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The walk (and the list of directories it skips) lives in lib/mjs-files.mjs
// so that this linter and test-all.mjs's syntax gate cannot disagree about
// which files exist — see that module's header for what happened when they
// did (#3419). The check itself is shared for the same reason
// (lib/syntax-check.mjs): one process parses every file, and `node --check`
// runs on any file that pass did not vouch for, so a failure below is still
// `node --check`'s own message (#5078).
const files = collectMjsFiles(root);
const { errors, fastPassUnavailable } = await checkSyntax(files, { cwd: root });
let failed = 0;

if (fastPassUnavailable) {
  console.error(`note: the single-process parse did not run (${fastPassUnavailable}); each file was checked with node --check instead.`);
}

files.forEach((file, i) => {
  const err = errors[i];
  if (!err) return;
  failed++;
  console.error(`✗ ${file.slice(root.length + 1)}`);
  console.error(String(err.stderr || err.message).trim());
});

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}

console.log(`✓ ${files.length} .mjs files passed syntax check.`);
