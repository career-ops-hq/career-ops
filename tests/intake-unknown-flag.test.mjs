// tests/intake-unknown-flag.test.mjs — a mistyped intake flag must not scan.
// `intake --txt path` used to ignore the flag, print the whole folder, and
// exit 0. --help must print usage and exit 0. --text=path must still extract
// that one file. --commit --all stays a real command.
//
// Run: node --test tests/intake-unknown-flag.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CV = '# Avery Quinn\n\nSenior analytics engineer. Metric layer, SQL.\n';

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-intake-flags-'));
  const docs = join(dir, 'documents', 'cv');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'master.md'), CV);
  return { dir };
}

function spawn(sb, args, extraEnv = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'intake.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      ...extraEnv,
      CAREER_OPS_ROOT: sb.dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_DOCUMENTS_DIR: '',
      CAREER_OPS_TRACKER: '',
      // After the spreads, so a developer shell value cannot redirect --commit.
      CAREER_OPS_INTAKE_STATE: join(sb.dir, 'data', 'intake-state.json'),
    },
  });
}

describe('intake rejects an unknown flag instead of scanning', () => {
  test('--txt exits 1 and does not print the scan', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['--txt', 'cv/master.md']);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /unrecognized flag/);
      assert.match(result.stderr, /--txt/);
      assert.doesNotMatch(result.stdout, /Avery Quinn/);
      assert.doesNotMatch(result.stdout, /"sources"/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--help and -h print usage and exit 0', () => {
    const sb = sandbox();
    try {
      for (const flag of ['--help', '-h']) {
        const result = spawn(sb, [flag]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage/);
        assert.doesNotMatch(result.stdout, /Avery Quinn/);
      }
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--summary still scans', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['--summary']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /master\.md/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--text with no path is a usage error', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['--text']);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /--text requires a value/);
      assert.doesNotMatch(result.stdout, /Avery Quinn/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--text=path prints that file', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['--text=cv/master.md']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Avery Quinn/);
      assert.doesNotMatch(result.stdout, /"sources"/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--commit --all is still accepted', () => {
    const sb = sandbox();
    const sandboxState = join(sb.dir, 'data', 'intake-state.json');
    // A developer who exported this variable must not have that file rewritten
    // by a test. The child used to inherit it through the spread of process.env.
    const inherited = join(sb.dir, 'inherited-intake-state.json');
    const inheritedBody = '{"ingested":{"sentinel":true}}\n';
    writeFileSync(inherited, inheritedBody);
    try {
      const result = spawn(sb, ['--commit', '--all'], { CAREER_OPS_INTAKE_STATE: inherited });
      assert.equal(result.status, 0, `${result.status} ${result.stderr}\n${result.stdout}`);
      assert.doesNotMatch(result.stderr, /unrecognized flag/);
      assert.match(result.stdout, /Recorded/);
      assert.ok(result.stdout.includes(sandboxState), result.stdout);
      assert.equal(existsSync(sandboxState), true, result.stdout);
      assert.equal(readFileSync(inherited, 'utf8'), inheritedBody);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });
});
