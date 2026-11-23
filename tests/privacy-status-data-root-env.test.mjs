// tests/privacy-status-data-root-env.test.mjs — the guard diagnostic must read
// the config the evaluators run with.
//
// Every evaluator loads `.env` from the data root first, then the working
// directory (`gemini-eval.mjs`, `scan.mjs`, `plugins/_engine.mjs`). A bare
// `import 'dotenv/config'` loads only the working directory's copy, so on a
// split-root or plugin install `privacy-status` could print "active" while every
// LLM call ran bypassed — the exact false assurance the command exists to
// prevent, and exit 0 is what a CI gate reads.
//
// The child runs from a scratch directory of its own, never the repository root,
// so a developer's own `.env` cannot decide the result, and the privacy variables
// are cleared from its environment for the same reason.
//
// Run:  node --test tests/privacy-status-data-root-env.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Run the diagnostic with a clean privacy environment from `cwd`, returning its
 * exit code and its parsed JSON.
 *
 * @param {string} dataRoot - CAREER_OPS_ROOT for the child.
 * @param {string} cwd - Working directory for the child, deliberately not ROOT.
 */
function runStatus(dataRoot, cwd) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  for (const key of Object.keys(env)) {
    // CAREER_OPS_PRIVACY points the guard at a specific config file, so an
    // inherited value would decide the answer instead of the data root's .env.
    if (/^PRIVACY_/.test(key) || key === 'CAREER_OPS_PRIVACY') delete env[key];
  }
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, 'privacy-status.mjs'), '--json'], {
      cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.status, json: err.stdout ? JSON.parse(err.stdout) : null };
  }
}

/**
 * A data root with an optional `.env`, plus a separate scratch working
 * directory, both removed afterwards.
 */
function withDataRoot(envText, fn) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'privacy-status-root-'));
  const cwd = mkdtempSync(join(tmpdir(), 'privacy-status-cwd-'));
  try {
    if (envText !== null) writeFileSync(join(dataRoot, '.env'), envText);
    return fn(dataRoot, cwd);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('a bypass written in the data root .env is reported, with exit 2', () => {
  withDataRoot('PRIVACY_GUARD=off\nPRIVACY_BYPASS_TOKEN=test-token\n', (dataRoot, cwd) => {
    const { code, json } = runStatus(dataRoot, cwd);
    assert.equal(json?.state, 'bypassed',
      'the diagnostic missed the bypass the evaluators would apply');
    assert.equal(code, 2, 'a bypassed guard must exit 2 so a CI gate sees it');
  });
});

test('a data root without .env leaves the guard active, with exit 0', () => {
  // The control: reading the data root must not become "always bypassed".
  withDataRoot(null, (dataRoot, cwd) => {
    const { code, json } = runStatus(dataRoot, cwd);
    assert.equal(json?.state, 'active');
    assert.equal(code, 0);
  });
});

test('the notice dotenv would print never reaches the JSON', () => {
  // `--json` reserves stdout for its own document; dotenv is loaded with
  // quiet: true for the same reason the scanner loads it that way.
  withDataRoot('PRIVACY_GUARD=off\nPRIVACY_BYPASS_TOKEN=test-token\n', (dataRoot, cwd) => {
    const { json } = runStatus(dataRoot, cwd);
    assert.ok(json && typeof json === 'object', 'stdout must parse as one JSON document');
  });
});