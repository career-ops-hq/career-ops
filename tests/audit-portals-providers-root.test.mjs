// tests/audit-portals-providers-root.test.mjs — audit-portals.mjs loads its
// provider registry from the CHECKOUT, not from the user's data root (#4171).
//
// `providers/` is system layer: it ships with the code and never travels to a
// data root. Anchoring it to getCareerOpsRoot() worked only while the data root
// and the checkout were the same directory. Under the external-data-root layout
// (CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR, or a `.career-ops-data` marker),
// loadProviders() read a directory that does not exist and returned an EMPTY
// registry — so audit-portals.mjs, the script whose whole job is catching the
// silent "enabled but nothing scans it" state, reported `0 audited` and exited
// 0. A green run that audited nothing is the worst shape this failure can take.
//
// The two assertions are deliberately a pair: the registry must follow the code
// root, and portals.yml must still follow the data root. Moving both onto one
// anchor is how this broke, so over-correcting has to fail here too.
//
// Run:  node --test tests/audit-portals-providers-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadProviders } from '../providers/_registry.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Import audit-portals.mjs with the data root pointed OUTSIDE the checkout.
 * The module resolves its anchors at import time, so the environment has to be
 * in place first; the query string keeps each call on its own module instance.
 */
async function importUnderDataRoot(dataRoot) {
  const previous = {
    root: process.env.CAREER_OPS_ROOT,
    dataDir: process.env.CAREER_OPS_DATA_DIR,
    portals: process.env.CAREER_OPS_PORTALS,
  };
  process.env.CAREER_OPS_ROOT = dataRoot;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_PORTALS;
  try {
    const url = `${pathToFileURL(join(ROOT, 'audit-portals.mjs')).href}?data-root=${encodeURIComponent(dataRoot)}`;
    return await import(url);
  } finally {
    for (const [name, value] of [
      ['CAREER_OPS_ROOT', previous.root],
      ['CAREER_OPS_DATA_DIR', previous.dataDir],
      ['CAREER_OPS_PORTALS', previous.portals],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-auditproviders-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  writeFileSync(
    join(dataRoot, 'portals.yml'),
    ['job_boards: []', 'tracked_companies:', '  - name: Data Root Co', '    careers_url: https://job-boards.greenhouse.io/datarootco', '    enabled: true', ''].join('\n'),
    'utf-8',
  );
  return dataRoot;
}

test('the provider registry is loaded from the checkout under an external data root', async () => {
  const dataRoot = fixture();
  try {
    const mod = await importUnderDataRoot(dataRoot);

    assert.equal(mod.PROVIDERS_DIR, join(ROOT, 'providers'), 'PROVIDERS_DIR must point at the checkout copy of providers/');
    assert.ok(!mod.PROVIDERS_DIR.startsWith(dataRoot), `PROVIDERS_DIR followed the data root: ${mod.PROVIDERS_DIR}`);

    const providers = await loadProviders(mod.PROVIDERS_DIR);
    assert.ok(providers.size > 0, 'the registry is empty, so every enabled board would be reported as no-provider');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('portals.yml still follows the data root', async () => {
  const dataRoot = fixture();
  try {
    const mod = await importUnderDataRoot(dataRoot);

    const companies = mod.loadCompanies();
    assert.deepEqual(
      companies.map((c) => c.name),
      ['Data Root Co'],
      'the default portals path must read the user data root, not the checkout',
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
