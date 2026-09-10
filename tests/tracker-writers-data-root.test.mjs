// tests/tracker-writers-data-root.test.mjs — the tracker WRITERS resolve the
// tracker against the user's data root (#3510's family, completing #3715).
//
// #3715 fixed the analysis scripts, which only read. These two write:
//
//   set-status.mjs:103    const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
//   set-status.mjs:263    const APPS_FILE  = resolveTrackerPath(CAREER_OPS);
//   mark-pdf-ready.mjs:45 / :105   the same pair
//
// The constant reads as the project root and holds the CODE root, so
// getCareerOpsRoot() — the only thing that honours CAREER_OPS_ROOT,
// CAREER_OPS_DATA_DIR and the .career-ops-data marker — was never consulted.
//
// set-status.mjs is the one that matters: AGENTS.md calls it "the canonical
// (locked, validated, atomic) write path", the tracker Pipeline Integrity rules
// say status changes go through it and NOT through hand edits, and #2901
// converged the web layer's /api/status onto it. So on any configured data root
// the single supported way to change a status answered
//
//     No tracker found at <CHECKOUT>/applications.md
//
// naming a file the user never configured, while their real tracker sat
// untouched.
//
// Each check runs with the data root and the cwd pointed at DIFFERENT
// directories — from the data root the two resolutions agree and the bug is
// invisible.
//
// Run:  node --test tests/tracker-writers-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Applied | ❌ | [1](../reports/001-acme.md) | n |',
  '',
].join('\n');

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-trwriter-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-trdecoy-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), TRACKER);
  return { dataRoot, decoyCwd };
}

const cleanup = (f) => {
  for (const d of [f.dataRoot, f.decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

function run(script, args, f) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: f.decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: f.dataRoot, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const trackerText = (f) => readFileSync(join(f.dataRoot, 'data', 'applications.md'), 'utf-8');

test('set-status writes to the configured tracker, not the checkout', () => {
  const f = fixture();
  try {
    const r = run('set-status.mjs', ['1', 'Interview', '--json'], f);
    assert.doesNotMatch(r.all, /No tracker found/i, `it looked in the checkout:\n${r.all.slice(0, 400)}`);
    assert.match(trackerText(f), /Interview/, `the configured tracker was not updated:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('and the status-log lands beside that tracker', () => {
  // data/status-log.tsv is the tracker's sibling ledger. A writer that finds the
  // tracker but logs elsewhere would split the record in two.
  const f = fixture();
  try {
    run('set-status.mjs', ['1', 'Interview'], f);
    assert.ok(
      existsSync(join(f.dataRoot, 'data', 'status-log.tsv')),
      `no ledger beside the tracker; data/ holds: ${readdirSync(join(f.dataRoot, 'data')).join(', ')}`,
    );
  } finally { cleanup(f); }
});

test('nothing is written into the directory it was launched from', () => {
  const f = fixture();
  try {
    run('set-status.mjs', ['1', 'Interview'], f);
    assert.deepEqual(readdirSync(f.decoyCwd), [], 'set-status wrote into the cwd');
  } finally { cleanup(f); }
});

test('outcome.mjs finds the configured tracker too', () => {
  // It shells out to set-status.mjs, so both halves have to resolve: the parent
  // to locate the tracker, and the child to write it. The child inherits
  // CAREER_OPS_ROOT through the environment.
  const f = fixture();
  try {
    const r = run('outcome.mjs', ['1', 'rejected'], f);
    assert.doesNotMatch(r.all, /Tracker not found|No tracker found/i, `it looked in the checkout:\n${r.all.slice(0, 400)}`);
    assert.match(trackerText(f), /Rejected/, `the outcome did not reach the configured tracker:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('mark-pdf-ready resolves the same tracker', () => {
  const f = fixture();
  try {
    const r = run('mark-pdf-ready.mjs', ['1'], f);
    assert.doesNotMatch(r.all, /No tracker found|not found at/i, `it looked in the checkout:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('templates/states.yml still resolves from the CODE root', () => {
  // The other half of set-status's split. states.yml ships with the code and is
  // NOT in a user's data root, so a blanket move to DATA_ROOT would break every
  // status validation — the check this script exists to perform.
  const f = fixture();
  try {
    const r = run('set-status.mjs', ['1', 'NotACanonicalState', '--json'], f);
    assert.doesNotMatch(r.all, /states\.yml/i, `states.yml was reported missing:\n${r.all.slice(0, 400)}`);
    // It must still REJECT the bogus state, which it can only do by having read
    // the template.
    assert.match(r.all, /invalid|unknown|not a canonical|canonical/i, `the state was not validated:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('no tracker writer resolves the tracker from its own directory', () => {
  // Structural, and scoped to the WRITERS because a wrong path there loses data
  // rather than just reporting nothing. Same spirit as #3511's check 6.
  const offenders = [];
  for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.mjs'))) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    const call = src.match(/resolveTrackerPath\(\s*([A-Z_]+)\s*\)/);
    if (!call) continue;
    const def = src.match(new RegExp(`^const ${call[1]}\\s*=\\s*(.+)$`, 'm'));
    if (def && /dirname\(\s*fileURLToPath/.test(def[1])) {
      offenders.push(`${file}: resolveTrackerPath(${call[1]}) where ${call[1]} = ${def[1].trim().slice(0, 50)}`);
    }
  }
  assert.deepEqual(offenders, [], `tracker resolved from the code root:\n${offenders.join('\n')}`);
});
