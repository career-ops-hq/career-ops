// tests/plugin-registry-localhost.test.mjs — a registry entry may only reach
// localhost if the entry says so, in the file the reviewer reads.
//
// The gap this was written for (#7708): the engine refuses a loopback host in
// allowedHosts unless the manifest sets allowsLocalhost (plugins/_engine.mjs,
// "allowedHosts contains a loopback host without allowsLocalhost"), but the
// registry schema had no such field, so validate-plugin-registry.mjs accepted
// plugins-registry/commute.json — allowedHosts: ["nominatim.openstreetmap.org",
// "localhost"] — while the plugin's own manifest carried the opt-in. The
// registry could not be satisfied on its own: either the install quietly added
// a permission the reviewer never saw, or the plugin was skipped at load time.
// docs/PLUGIN_REVIEW.md and the registry PR template already require "no
// localhost without allowsLocalhost + a reason"; this is the schema catching up
// with the review checklist.
//
// The rule below is the engine's, restated at review time: allowsLocalhost is a
// boolean when present, and it must be true when any allowedHosts entry is a
// loopback name. It is deliberately not stricter than the engine — an entry
// that opts in without listing a loopback host is still accepted, because the
// engine accepts it too.
//
// Run:  node --test tests/plugin-registry-localhost.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from '../validate-plugin-registry.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * A throwaway registry root. The dir is always created, because loadRegistry()
 * fails open to the codebase root when it finds no plugins-registry/ — an empty
 * temp dir would silently validate the shipped registry instead of the fixture.
 */
function makeRegistry(entries) {
  const root = mkdtempSync(join(tmpdir(), 'co-localhost-'));
  mkdirSync(join(root, 'plugins-registry'));
  for (const e of entries) {
    writeFileSync(join(root, 'plugins-registry', `${e.id}.json`), JSON.stringify(e, null, 2));
  }
  return root;
}

const entry = (id, overrides = {}) => ({
  name: `career-ops-plugin-${id}`,
  id,
  repo: `https://github.com/someone/career-ops-plugin-${id}`,
  author: 'someone',
  hooks: ['ingest'],
  description: `${id} test entry`,
  requiredEnv: [],
  allowedHosts: ['api.example.com'],
  license: 'MIT',
  version: '0.1.0',
  sha: 'a'.repeat(40),
  ...overrides,
});

const check = (entries) => {
  const root = makeRegistry(entries);
  try { return validateRegistry(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('the shipped registry is valid: commute declares the localhost opt-in it needs', () => {
  assert.deepEqual(validateRegistry(REPO_ROOT), []);
});

test('a loopback host without allowsLocalhost is rejected, whichever spelling is used', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST']) {
    const problems = check([entry('beta', { allowedHosts: ['api.example.com', host] })]);
    assert.equal(problems.length, 1, `${host}: ${JSON.stringify(problems)}`);
    assert.match(problems[0], /career-ops-plugin-beta: allowedHosts contains a loopback host, so allowsLocalhost must be true/);
  }
});

test('a loopback host with allowsLocalhost: true is accepted', () => {
  assert.deepEqual(check([entry('beta', { allowedHosts: ['api.example.com', 'localhost'], allowsLocalhost: true })]), []);
});

test('allowsLocalhost must be the boolean true, not a truthy stand-in', () => {
  for (const value of ['true', 1, null]) {
    const problems = check([entry('beta', { allowedHosts: ['localhost'], allowsLocalhost: value })]);
    assert.equal(problems.length, 1, `${JSON.stringify(value)}: ${JSON.stringify(problems)}`);
    assert.match(problems[0], /allowsLocalhost, if present, must be a boolean/);
  }
});

test('the opt-in is accepted on an entry that lists no loopback host (the engine does too)', () => {
  assert.deepEqual(check([entry('beta', { allowsLocalhost: true })]), []);
});
