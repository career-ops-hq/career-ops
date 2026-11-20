// Zero-network smoke test: the entry imports cleanly and exposes only valid
// hooks that match the manifest. Run by `plugins.mjs add` + the registry CI.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// A literal path, so the static audit can read what this test loads. If your
// manifest sets a different `entry`, change it here too.
import hooks from '../index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KINDS = ['provider', 'ingest', 'search', 'notify', 'export'];

const manifest = JSON.parse(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8'));
// The literal import above no longer follows manifest.entry: catch a plugin
// that changes its entry and forgets this test.
assert.equal(manifest.entry ?? 'index.mjs', 'index.mjs', 'manifest.entry changed: update the import at the top of this test');

assert(hooks && typeof hooks === 'object', 'default export must be an object of hooks');
const keys = Object.keys(hooks);
assert(keys.length > 0, 'declare at least one hook');
for (const k of keys) assert(KINDS.includes(k), `unknown hook "${k}"`);
for (const h of manifest.hooks) assert(keys.includes(h), `manifest declares hook "${h}" but index.mjs does not export it`);

console.log('✓ smoke ok:', keys.join(', '));
