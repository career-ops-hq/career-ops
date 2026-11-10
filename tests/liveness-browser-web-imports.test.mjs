// tests/liveness-browser-web-imports.test.mjs — the core files the web app loads
// at runtime import nothing from npm.
//
// web/src/lib/apply/url-guard.mjs loads liveness-browser.mjs from the core
// checkout. The web install only has web/node_modules, so a bare package import
// anywhere in that file's import closure fails there with ERR_MODULE_NOT_FOUND.
// #5177 made liveness-core.mjs import history-ats-seeds.mjs, which reaches
// tracker-utils.mjs and js-yaml, and Web CI went red on main. The core suite
// cannot see this: the root install has js-yaml.
//
// Run:  node --test tests/liveness-browser-web-imports.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_POINTS = ['liveness-browser.mjs'];
const BUILTINS = new Set(builtinModules);
const SPECIFIER = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;

function packageImports(entry) {
  const seen = new Set();
  const queue = [resolve(ROOT, entry)];
  const found = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (existsSync(target)) queue.push(target);
      } else if (!spec.startsWith('node:') && !BUILTINS.has(spec)) {
        found.push(`${relative(ROOT, file)} imports '${spec}'`);
      }
    }
  }
  return found;
}

for (const entry of ENTRY_POINTS) {
  test(`${entry}: its import closure uses only Node built-ins`, () => {
    assert.deepEqual(packageImports(entry), []);
  });
}
