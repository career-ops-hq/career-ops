import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const SCRIPT = fileURLToPath(new URL('../migrate-scan-runs.mjs', import.meta.url));
const OLD_RUNS = 'timestamp\tstatus\tcompanies\tboards\tfound\tfiltered_title\tfiltered_tier\tfiltered_location\tfiltered_salary\tfiltered_content\tfiltered_cooldown\tdupes\tnew_added\terrors\n' +
  '2026-01-01T00:00:00Z\tcompleted\t1\t1\t2\t0\t0\t0\t0\t0\t0\t0\t2\t0\n';

function fixture(t, populated = true) {
  const root = mkdtempSync(join(tmpdir(), 'co-migrate-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(root, 'data'));
  const file = join(root, 'data', 'scan-runs.tsv');
  if (populated) writeFileSync(file, OLD_RUNS);
  return { root, file };
}

function run(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    env: { ...env, CAREER_OPS_ROOT: root },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

for (const flag of ['--help', '-h']) {
  test(`${flag} with --apply leaves the scan history untouched and creates no backup`, (t) => {
    const { root, file } = fixture(t);
    const result = run(root, ['--file', file, '--apply', flag]);
    assert.equal(readFileSync(file, 'utf8'), OLD_RUNS);
    assert.equal(existsSync(`${file}.bak`), false);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /^Usage:.*migrate-scan-runs\.mjs/m);
    assert.equal(result.stderr, '');
  });

  test(`${flag} prints the same help with missing or populated scan history`, (t) => {
    const empty = fixture(t, false);
    const full = fixture(t);
    const missingResult = run(empty.root, [flag]);
    const fullResult = run(full.root, [flag]);
    assert.equal(missingResult.status, 0, describeSpawn(missingResult));
    assert.equal(fullResult.status, 0, describeSpawn(fullResult));
    assert.equal(fullResult.stdout, missingResult.stdout);
    for (const option of ['--apply', '--file', '--json', '--help', '-h']) {
      assert.ok(fullResult.stdout.includes(option), `usage is missing ${option}`);
    }
    assert.equal(readFileSync(full.file, 'utf8'), OLD_RUNS);
    assert.equal(existsSync(`${full.file}.bak`), false);
    assert.equal(existsSync(empty.file), false);
  });
}

test('an empty --file value is rejected before --apply can use the default file', (t) => {
  for (const args of [['--file=', '--apply'], ['--file', '', '--apply'], ['--file', '   ', '--apply']]) {
    const { root, file } = fixture(t);
    const result = run(root, args);
    assert.ok(exitedNonZero(result), describeSpawn(result, `accepted ${JSON.stringify(args)}`));
    assert.match(result.stderr, /--file.*requires.*value/i);
    assert.equal(readFileSync(file, 'utf8'), OLD_RUNS);
    assert.equal(existsSync(`${file}.bak`), false);
  }
});

test('unknown flags and missing --file values fail before reading or writing history', (t) => {
  const { root, file } = fixture(t);
  for (const args of [
    ['--apply', '--fiel', file],
    ['--apply', '--bogus', '--help'],
    ['--apply', '--file'],
    ['--file', '--help'],
  ]) {
    const result = run(root, args);
    assert.ok(exitedNonZero(result), describeSpawn(result, `accepted ${JSON.stringify(args)}`));
    assert.match(result.stderr, /unrecognized flag|--file requires (?:a value|a path argument)/i);
    assert.equal(readFileSync(file, 'utf8'), OLD_RUNS);
    assert.equal(existsSync(`${file}.bak`), false);
  }
});

test('help flags cannot supply --file or migrate the default history', (t) => {
  const { root, file } = fixture(t);
  for (const help of ['--help', '-h']) {
    for (const args of [['--file', help], ['--apply', '--file', help]]) {
      const result = run(root, args);
      assert.equal(result.status, 1, `accepted ${args.join(' ')}`);
      assert.match(result.stderr, /--file requires (?:a value|a path argument)/);
      assert.equal(result.stdout, '');
      assert.equal(readFileSync(file, 'utf8'), OLD_RUNS);
      assert.equal(existsSync(`${file}.bak`), false);
    }
  }
});

test('preview and --apply retain their behavior for both --file forms', (t) => {
  for (const equalsForm of [false, true]) {
    const { root, file: defaultFile } = fixture(t);
    const target = join(root, 'selected history.tsv');
    writeFileSync(target, OLD_RUNS);
    const fileArgs = equalsForm ? [`--file=${target}`] : ['--file', target];
    const preview = run(root, [...fileArgs, '--json']);
    assert.equal(preview.status, 0, describeSpawn(preview));
    assert.equal(JSON.parse(preview.stdout).applied, false);
    assert.equal(readFileSync(target, 'utf8'), OLD_RUNS);
    assert.equal(existsSync(`${target}.bak`), false);

    const apply = run(root, [...fileArgs, '--json', '--apply']);
    assert.equal(apply.status, 0, describeSpawn(apply));
    assert.equal(JSON.parse(apply.stdout).applied, true);
    assert.notEqual(readFileSync(target, 'utf8'), OLD_RUNS);
    assert.equal(readFileSync(`${target}.bak`, 'utf8'), OLD_RUNS);
    assert.equal(readFileSync(defaultFile, 'utf8'), OLD_RUNS);
    assert.equal(existsSync(`${defaultFile}.bak`), false);
  }
});
