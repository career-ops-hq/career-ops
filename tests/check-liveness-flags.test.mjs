// check-liveness must reject flags it does not understand, and a missing
// --file must be its own usage error.
//
// Two defects showed up as one command:
//
//   node check-liveness.mjs --file
//   printed "invite-match: --file requires a path argument" and exited.
//   check-liveness imports scan.mjs, which imports invite-match.mjs for
//   normalizeCompanyName. The missing-operand process.exit in invite-match
//   ran at import time, against the importer's argv, so check-liveness never
//   reached its own main().
//
//   node check-liveness.mjs --dry-run --file urls.txt
//   never opened the file. Unknown tokens were left in the URL list, so
//   --dry-run, --file, and the path were each "checked" as a posting URL.
//   --help was handled before that filter, so --help --bogus exited 0.
//
// Offline. The only URL the happy path checks is the literal string
// "not-a-url", which the liveness checker rejects without DNS or a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';
import { ROOT } from './helpers.mjs';

const SCRIPT = join(ROOT, 'check-liveness.mjs');

function run(args, extra = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 20000,
    env: { ...process.env, ...extra.env },
    cwd: extra.cwd || ROOT,
  });
}

function out(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

test('a bare --file is a check-liveness usage error, not an invite-match exit', () => {
  const result = run(['--file']);
  const text = out(result);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.doesNotMatch(text, /invite-match/);
  assert.match(text, /--file requires a value/);
  assert.doesNotMatch(text, /Checking /);
});

test('importing invite-match does not exit when argv has a bare --file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'invite-import-'));
  const importer = join(dir, 'importer.mjs');
  const href = pathToFileURL(join(ROOT, 'invite-match.mjs')).href;
  writeFileSync(importer, `import { normalizeCompanyName } from ${JSON.stringify(href)};\nconsole.log('imported ' + normalizeCompanyName('Acme Inc'));\n`);
  try {
    const result = spawnSync(process.execPath, [importer, '--file'], {
      encoding: 'utf-8',
      timeout: 15000,
      cwd: ROOT,
    });
    const text = out(result);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(text, /imported acme/);
    assert.doesNotMatch(text, /invite-match: --file requires/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown flag is rejected instead of checked as a URL', () => {
  const result = run(['--bogus', 'not-a-url']);
  const text = out(result);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(text, /unrecognized flag/);
  assert.match(text, /--bogus/);
  assert.doesNotMatch(text, /Checking /);
});

test('--help --bogus reports the unknown flag', () => {
  const result = run(['--help', '--bogus']);
  const text = out(result);
  assert.ok(exitedNonZero(result), describeSpawn(result));
  assert.match(text, /unrecognized flag/);
  assert.match(text, /--bogus/);
});

test('--dry-run --file does not treat the flag or the path as URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveness-flags-'));
  const file = join(dir, 'urls.txt');
  writeFileSync(file, 'not-a-url\n');
  try {
    const result = run(['--dry-run', '--no-record', '--file', file]);
    const text = out(result);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(text, /unrecognized flag/);
    assert.match(text, /--dry-run/);
    assert.doesNotMatch(text, /Checking /);
    assert.doesNotMatch(text, /not-a-url/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--file reads the path that follows it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveness-file-'));
  const file = join(dir, 'urls.txt');
  writeFileSync(file, 'not-a-url\n');
  try {
    const result = run(['--no-record', '--no-fallback', '--file', file]);
    const text = out(result);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(text, /Checking 1 URL/);
    assert.match(text, /not-a-url/);
    assert.doesNotMatch(text, /invite-match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the space form of --throttle is the wait, not another URL', () => {
  const result = run(['--throttle', '1000', '--no-record', '--no-fallback', 'not-a-url']);
  const text = out(result);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(text, /Checking 1 URL/);
  assert.match(text, /throttle ~1-2s/);
  assert.doesNotMatch(text, /Checking 2 URL/);
});
