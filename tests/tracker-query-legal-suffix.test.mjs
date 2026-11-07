// tracker query --company used a SQL LIKE only. "Acme Labs, Inc." returned
// no rows when the tracker cell was "Acme Labs". set-status already matches
// that pair through companiesMatchIgnoringCorporateForm. Query did not.
// A substring that is not a legal suffix still matches through LIKE, and an
// extra word that is not a corporate form ("Acme Robotics") does not match
// "Acme Labs".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, describeSpawn } from './helpers.mjs';

function trackerRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-query-suffix-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-01 | Acme Labs | Analyst | 4/5 | Applied | — | — | fictional |',
    '| 2 | 2026-09-02 | Other Freight | Analyst | 3/5 | Applied | — | — | fictional |',
    '',
  ].join('\n'));
  return root;
}

function query(root, company) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith('CAREER_OPS_')) delete env[name];
  return spawnSync(process.execPath, [join(ROOT, 'tracker.mjs'), 'query', '--json', '--company', company], {
    env: { ...env, CAREER_OPS_ROOT: root },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function ids(result) {
  assert.equal(result.status, 0, describeSpawn(result));
  return JSON.parse(result.stdout).map((r) => r.id);
}

test('query --company matches a row when only the legal suffix differs', (t) => {
  const root = trackerRoot(t);
  assert.deepEqual(ids(query(root, 'Acme Labs, Inc.')), [1]);
});

test('query --company still matches a substring of the company cell', (t) => {
  const root = trackerRoot(t);
  assert.deepEqual(ids(query(root, 'Acme')), [1]);
});

test('query --company does not match a different company that shares a stem', (t) => {
  const root = trackerRoot(t);
  assert.deepEqual(ids(query(root, 'Acme Robotics')), []);
});
