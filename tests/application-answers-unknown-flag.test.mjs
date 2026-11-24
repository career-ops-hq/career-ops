import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'application-answers.mjs');
const ORIGINAL = '# Report\n\n## Application Answers\n';

function run(dir, args) {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 15000,
    env,
  });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'co-answers-'));
  const report = join(dir, 'report.md');
  const input = join(dir, 'answers.json');
  writeFileSync(report, ORIGINAL);
  writeFileSync(input, '{"freeText":["kept"]}\n');
  return { dir, report, input };
}

test('application-answers rejects an unknown flag and does not write the report', () => {
  const { dir, report, input } = fixture();
  try {
    const r = run(dir, ['--report', report, '--input', input, '--statee', 'submitted']);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Unrecognized flag: --statee/);
    assert.equal(readFileSync(report, 'utf8'), ORIGINAL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('application-answers still writes when --state is a real flag', () => {
  const { dir, report, input } = fixture();
  try {
    const r = run(dir, ['--report', report, '--input', input, '--state', 'submitted']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(report, 'utf8'), /\*\*State:\*\* submitted/);
    assert.doesNotMatch(r.stdout, /Unrecognized flag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
