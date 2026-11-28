// tests/tracker-sync-check-missing-file.test.mjs — an explicit --apps-file or
// --interviews-file that does not exist, or is empty, is an error, not a clean
// comparison.
//
// A mistyped path was read as an empty table, so the check printed no
// mismatches and exited 0 for a file it never read. An empty value fell back to
// the default file. As in #7840 and #7781, only the default paths may be absent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'tracker-sync-missing-'));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
mkdirSync(join(root, 'data'));
const apps = join(root, 'data', 'applications.md');
writeFileSync(apps, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-11-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | — | |\n');
const interviews = join(root, 'data', 'active-interviews.md');
writeFileSync(interviews, '| Company | Role | Status | Notes |\n|---|---|---|---|\n| Acme | Engineer | Interview | |\n');

function run(...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(ROOT, 'tracker-sync-check.mjs'), ...args], { cwd: root, encoding: 'utf-8', env, timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  return r;
}

for (const flag of ['--apps-file', '--interviews-file']) {
  test(`a ${flag} that does not exist exits 1 and names it`, () => {
    const r = run(flag, join(root, 'data', 'typo.md'), '--summary');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, new RegExp(`${flag} not found: .*typo\\.md`));
    assert.equal(r.stdout, '');
  });

  test(`an empty ${flag} exits 1 instead of reading the default file`, () => {
    for (const args of [[flag, ''], [`${flag}=`]]) {
      const r = run(...args, '--summary');
      assert.equal(r.status, 1, `${args.join(' ')}\n${describeSpawn(r)}`);
      assert.equal(r.stdout, '');
    }
  });
}

test('control: existing files, and the defaults, are still compared', () => {
  for (const args of [['--apps-file', apps, '--interviews-file', interviews], []]) {
    const r = run(...args);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.ok(Array.isArray(JSON.parse(r.stdout).mismatches), describeSpawn(r));
  }
});
