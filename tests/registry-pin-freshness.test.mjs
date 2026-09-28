// tests/registry-pin-freshness.test.mjs — a registry pin has to be checkable
// against the plugin's own published release, and the check has to keep
// "I could not tell" distinct from "it is current".
//
// The gap this was written for: nothing ever re-read a pin after it was
// written. plugins-registry/<id>.json pins the SHA plugin-install.mjs clones,
// and the registry-validate CI only fires on `pull_request` touching
// plugins-registry/**. A plugin cutting a release changes nothing in this repo,
// so no PR runs, so the pin is only ever validated at the one moment it is
// guaranteed correct. Two entries drifted three patch releases behind that way,
// one of them past a rendering fix, and the registry still read `✓ approved`.
//
// Every case below pins one property that makes the check worth having:
// a SHA that trails its release is stale even when nothing else moved; an
// entry whose author never cut a release is not stale; and a lookup that
// FAILED is never reported as fresh — a network error that reads as green is
// the failure mode that let this rot in the first place.
//
// Run:  node --test tests/registry-pin-freshness.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRegistryFreshness } from '../validate-plugin-registry.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/**
 * A throwaway registry root. The dir is ALWAYS created, because loadRegistry()
 * fails open to the codebase root when it finds no plugins-registry/ — an
 * empty temp dir would silently test the shipped registry and hit the network.
 */
function makeRegistry(entries) {
  const root = mkdtempSync(join(tmpdir(), 'co-freshness-'));
  mkdirSync(join(root, 'plugins-registry'));
  for (const e of entries) {
    writeFileSync(join(root, 'plugins-registry', `${e.id}.json`), JSON.stringify(e, null, 2));
  }
  return root;
}

const entry = (id, sha) => ({
  id,
  name: `career-ops-plugin-${id}`,
  repo: `https://github.com/someone/career-ops-plugin-${id}`,
  version: '0.1.0',
  license: 'MIT',
  description: `${id} test entry`,
  hooks: ['export'],
  sha,
});

test('a pin that equals the latest release commit is fresh', async () => {
  const root = makeRegistry([entry('alpha', SHA_A)]);
  try {
    const res = await checkRegistryFreshness(root, {
      fetchRelease: async () => ({ tag: 'v0.1.0', sha: SHA_A }),
    });
    assert.equal(res.length, 1);
    assert.equal(res[0].status, 'fresh');
    assert.equal(res[0].id, 'alpha');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pin behind the latest release is stale, and names both commits', async () => {
  const root = makeRegistry([entry('alpha', SHA_A)]);
  try {
    const res = await checkRegistryFreshness(root, {
      fetchRelease: async () => ({ tag: 'v0.2.0', sha: SHA_B }),
    });
    assert.equal(res[0].status, 'stale');
    assert.equal(res[0].pinnedSha, SHA_A);
    assert.equal(res[0].releaseSha, SHA_B);
    assert.equal(res[0].releaseTag, 'v0.2.0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an entry whose repo published no release is not stale', async () => {
  const root = makeRegistry([entry('alpha', SHA_A)]);
  try {
    const res = await checkRegistryFreshness(root, { fetchRelease: async () => null });
    assert.equal(res[0].status, 'no-release');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failed lookup reports error, never fresh', async () => {
  const root = makeRegistry([entry('alpha', SHA_A)]);
  try {
    const res = await checkRegistryFreshness(root, {
      fetchRelease: async () => { throw new Error('502 Bad Gateway'); },
    });
    assert.equal(res[0].status, 'error');
    assert.notEqual(res[0].status, 'fresh');
    assert.match(res[0].detail, /502/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every entry is checked, and one bad entry does not mask the rest', async () => {
  const root = makeRegistry([entry('alpha', SHA_A), entry('beta', SHA_A), entry('gamma', SHA_A)]);
  try {
    const res = await checkRegistryFreshness(root, {
      fetchRelease: async (repo) => {
        if (repo.endsWith('beta')) throw new Error('boom');
        if (repo.endsWith('gamma')) return { tag: 'v9.9.9', sha: SHA_B };
        return { tag: 'v0.1.0', sha: SHA_A };
      },
    });
    // Proves the loop actually ran over all three rather than short-circuiting.
    assert.equal(res.length, 3);
    const byId = Object.fromEntries(res.map(r => [r.id, r.status]));
    assert.deepEqual(byId, { alpha: 'fresh', beta: 'error', gamma: 'stale' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the fixture is real: a registry with no entries yields no results', async () => {
  // Guards the fail-open in loadRegistry(). If this ever returns rows, the
  // suite is reading the shipped registry and every assertion above is vacuous.
  const root = makeRegistry([]);
  try {
    const res = await checkRegistryFreshness(root, {
      fetchRelease: async () => { throw new Error('the network must not be reached'); },
    });
    assert.deepEqual(res, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
