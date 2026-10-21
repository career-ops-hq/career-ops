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
import { checkRegistryFreshness, fetchLatestRelease } from '../validate-plugin-registry.mjs';

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

// ── fetchLatestRelease: the real resolver, with the HTTP layer injected ──────
//
// Everything above injects `fetchRelease` and therefore never exercises the
// function that actually talks to GitHub. These do, through a fake transport,
// because the resolver carries two claims that only it can be held to:
//
//   1. A 404 from /releases/latest is AMBIGUOUS. It means "this repo published
//      no release" and it equally means "this repo is gone, renamed away, or
//      private". Measured against the live API: an existing repo with no
//      release answers 404 on releases and 200 on /repos/{slug}; a repo that
//      does not exist answers 404 on both. Collapsing the second into the
//      benign `no-release` resting state is the exact failure this module
//      claims to prevent, and it is the scenario in #4186 (plugin repos
//      reported as vanished) — the case the check most needs to catch.
//   2. The release tag is resolved through /commits/<tag>, so an ANNOTATED tag
//      yields the commit it wraps rather than the tag object's own SHA. Nothing
//      else in the suite pins that.

const COMMIT_SHA = 'c'.repeat(40);

/** A fake transport: a map of URL-substring → {status, body}. */
function transport(routes) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      const hit = Object.entries(routes).find(([frag]) => url.includes(frag));
      if (!hit) throw new Error(`unrouted request: ${url}`);
      const { status, body } = hit[1];
      return {
        status,
        ok: status >= 200 && status < 300,
        statusText: `synthetic ${status}`,
        json: async () => body,
      };
    },
  };
}

test('fetchLatestRelease resolves a release to the commit its tag points at', async () => {
  const t = transport({
    '/releases/latest': { status: 200, body: { tag_name: 'v1.2.3' } },
    '/commits/': { status: 200, body: { sha: COMMIT_SHA } },
  });
  const rel = await fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl });
  assert.deepEqual(rel, { tag: 'v1.2.3', sha: COMMIT_SHA });
});

test('an ANNOTATED tag resolves to the wrapped commit, not the tag object SHA', async () => {
  // /commits/<tag> dereferences the annotation; the tag object's own SHA
  // (TAG_OBJECT below) must never be what comes back.
  const TAG_OBJECT = 'd'.repeat(40);
  const t = transport({
    '/releases/latest': { status: 200, body: { tag_name: 'v2.0.0', target_commitish: TAG_OBJECT } },
    '/commits/': { status: 200, body: { sha: COMMIT_SHA } },
  });
  const rel = await fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl });
  assert.equal(rel.sha, COMMIT_SHA);
  assert.notEqual(rel.sha, TAG_OBJECT);
  assert.ok(t.calls.some(u => u.includes('/commits/v2.0.0')), 'must resolve through /commits/<tag>');
});

test('no release + repo reachable is a genuine no-release (null)', async () => {
  const t = transport({
    '/releases/latest': { status: 404, body: {} },
    '/repos/o/career-ops-plugin-x': { status: 200, body: { full_name: 'o/career-ops-plugin-x' } },
  });
  const rel = await fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl });
  assert.equal(rel, null);
});

test('no release + repo NOT reachable throws, and never reads as no-release', async () => {
  // The regression guard. Before the disambiguation this returned null, so a
  // deleted plugin repo surfaced as the benign `no-release` state.
  const t = transport({
    '/releases/latest': { status: 404, body: {} },
    '/repos/o/career-ops-plugin-gone': { status: 404, body: {} },
  });
  await assert.rejects(
    () => fetchLatestRelease('https://github.com/o/career-ops-plugin-gone', { fetchImpl: t.fetchImpl }),
    /not reachable|inaccessible|404/i,
  );
});

test('a rate-limited repo probe throws rather than guessing no-release', async () => {
  // 403 on the disambiguating call means "could not tell", which is an error,
  // not an absence. Guessing either way here would be inventing a fact.
  const t = transport({
    '/releases/latest': { status: 404, body: {} },
    '/repos/o/career-ops-plugin-x': { status: 403, body: {} },
  });
  await assert.rejects(() => fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl }));
});

test('a release whose tag will not resolve to a commit throws', async () => {
  const t = transport({
    '/releases/latest': { status: 200, body: { tag_name: 'v9.9.9' } },
    '/commits/': { status: 404, body: {} },
  });
  await assert.rejects(
    () => fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl }),
    /resolves to no commit/,
  );
});

test('the repo probe runs only on the 404 path, not on every lookup', async () => {
  // The disambiguation costs a second request. It must not be paid by the
  // common case, which is a repo that has a release.
  const t = transport({
    '/releases/latest': { status: 200, body: { tag_name: 'v1.0.0' } },
    '/commits/': { status: 200, body: { sha: COMMIT_SHA } },
  });
  await fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl });
  const repoProbes = t.calls.filter(u => /\/repos\/[^/]+\/[^/]+$/.test(u));
  assert.equal(repoProbes.length, 0, 'no bare /repos/{slug} probe on the happy path');
});

test('a 200 release response with no tag_name is an error, not an absence', async () => {
  // Malformed is not the same as absent. Routing it through the reachability
  // probe would return no-release for a repo that answered successfully, and
  // the probe would always pass, so the anomaly would vanish silently.
  const t = transport({
    '/releases/latest': { status: 200, body: { name: 'untagged somehow' } },
    '/repos/o/career-ops-plugin-x': { status: 200, body: {} },
  });
  await assert.rejects(
    () => fetchLatestRelease('https://github.com/o/career-ops-plugin-x', { fetchImpl: t.fetchImpl }),
    /no tag_name/,
  );
  assert.ok(!t.calls.some(u => /\/repos\/[^/]+\/[^/]+$/.test(u)), 'must not probe reachability for a malformed 200');
})

test('an unparseable repo URL fails before any request is made', async () => {
  // Guards the guards: without this, a bare assert.rejects elsewhere could be
  // passing on a repoSlug() throw rather than on the behavior it names.
  const t = transport({});
  await assert.rejects(
    () => fetchLatestRelease('not-a-github-url', { fetchImpl: t.fetchImpl }),
    /unparseable repo URL/,
  );
  assert.equal(t.calls.length, 0);
})

test('the production entry path runs end to end with no injection at all', async () => {
  // Every other checkRegistryFreshness test overrides fetchRelease, so the
  // default binding to fetchLatestRelease — the only thing the scheduled
  // workflow ever calls — was executed by nothing. Rewiring that default to
  // `async () => null` leaves the rest of this file green while every entry
  // reports `no-release` and the job exits 0 calling the registry healthy,
  // which is #4186 happening under a passing suite.
  const root = makeRegistry([entry('alpha', SHA_A)]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    status: 404, ok: false, statusText: 'synthetic 404', json: async () => ({}),
  });
  try {
    const res = await checkRegistryFreshness(root); // no options: the real path
    assert.equal(res.length, 1);
    assert.equal(res[0].status, 'error');
    assert.match(res[0].detail, /not reachable/);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(root, { recursive: true, force: true });
  }
});
