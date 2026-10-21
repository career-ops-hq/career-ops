import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/export-ats-text.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'co-export-ats-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

function run(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    env: {
      ...env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_PROFILE: join(root, 'profile.yml'),
      CAREER_OPS_CV: join(root, 'cv.md'),
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

for (const flag of ['--help', '-h']) {
  test(`${flag} prints usage without requiring a profile or CV`, (t) => {
    const result = run(fixture(t), [flag]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage:.*export-ats-text\.mjs/m);
    for (const option of ['--section', '--out', '--profile', '--cv', '--help', '-h']) {
      assert.ok(result.stdout.includes(option), `usage is missing ${option}`);
    }
    assert.equal(result.stderr, '');
  });

  test(`${flag} leaves inputs and existing output unchanged, and creates no output`, (t) => {
    const root = fixture(t);
    const empty = run(root, [flag]);
    const profile = join(root, 'profile.yml');
    const cv = join(root, 'cv.md');
    const existing = join(root, 'export.txt');
    const missing = join(root, 'new-directory', 'export.txt');
    // Invalid YAML also proves help stops before loading the profile.
    writeFileSync(profile, 'candidate: [invalid YAML');
    writeFileSync(cv, '# Fictional Candidate\n\n## Skills\n- Node.js\n');
    writeFileSync(existing, 'Keep this previous export.\n');
    const before = [profile, cv, existing].map((path) => readFileSync(path));
    const entries = readdirSync(root).sort();
    for (const output of [existing, missing]) {
      const result = run(root, [flag, '--profile', profile, '--cv', cv, '--out', output]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, empty.stdout);
      assert.equal(result.stderr, '');
    }
    assert.deepEqual([profile, cv, existing].map((path) => readFileSync(path)), before);
    assert.deepEqual(readdirSync(root).sort(), entries);
    assert.equal(existsSync(missing), false);
  });
}

test('unknown flags and missing values still fail without creating an export', (t) => {
  const root = fixture(t);
  const output = join(root, 'export.txt');
  for (const args of [
    ['--bogus', '--out', output],
    ['--help', '--bogus', '--out', output],
    ['--out'],
    ['--help', '--profile'],
  ]) {
    const result = run(root, args);
    assert.notEqual(result.status, 0, `accepted ${args.join(' ')}`);
    assert.equal(existsSync(output), false);
  }
});

test('help flags cannot supply a required value or overwrite an export', (t) => {
  const root = fixture(t);
  const output = join(root, 'export.txt');
  writeFileSync(output, 'Keep this previous export.\n');
  for (const option of ['--section', '--out', '--profile', '--cv']) {
    for (const help of ['--help', '-h']) {
      const result = run(root, ['--out', output, option, help]);
      assert.equal(result.status, 1, `accepted ${option} ${help}`);
      assert.match(result.stderr, new RegExp(`${option} requires a value`));
      assert.equal(result.stdout, '');
      assert.equal(readFileSync(output, 'utf8'), 'Keep this previous export.\n');
      assert.deepEqual(readdirSync(root), ['export.txt']);
    }
  }
});

test('normal exports still support explicit profile, CV, section and output options', (t) => {
  const root = fixture(t);
  const profile = join(root, 'profile.yml');
  const cv = join(root, 'cv.md');
  const output = join(root, 'export.txt');
  writeFileSync(profile, 'candidate:\n  full_name: Fictional Candidate\n');
  writeFileSync(cv, '# Fictional Candidate\n\n## Skills\n- Node.js, SQL\n');
  const args = ['--profile', profile, '--cv', cv, '--section', 'skills'];
  const stdout = run(root, args);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.equal(stdout.stdout.trim(), '--- KEY SKILLS ---\nNode.js, SQL');
  const file = run(root, [...args, '--out', output]);
  assert.equal(file.status, 0, file.stderr);
  assert.equal(readFileSync(output, 'utf8'), '--- KEY SKILLS ---\nNode.js, SQL');
});
