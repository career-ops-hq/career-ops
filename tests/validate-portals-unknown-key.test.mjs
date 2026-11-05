// A typo inside title_filter used to validate clean. `positve` left `positive`
// empty, and an empty positive list matches every posting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'co-portal-unknown-key-'));

function run(file) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  return spawnSync(process.execPath, [join(ROOT, 'validate-portals.mjs'), '--file', file], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env,
  });
}

test('validate-portals rejects title_filter.positve and names the closest key', () => {
  const file = join(dir, 'positve.yml');
  writeFileSync(file, 'title_filter:\n  positve:\n    - analyst\n');
  const r = run(file);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 1, out);
  assert.match(out, /positve/);
  assert.match(out, /did you mean "positive"/);
  assert.doesNotMatch(out, /0 errors/);
});

test('validate-portals accepts a spelled title_filter.positive list', () => {
  const file = join(dir, 'positive.yml');
  writeFileSync(file, 'title_filter:\n  positive:\n    - analyst\n  negative:\n    - intern\n');
  const r = run(file);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 0, out);
  assert.match(out, /0 errors/);
});

test('validate-portals names an unknown title_filter key that is not a near miss', () => {
  const file = join(dir, 'notes.yml');
  writeFileSync(file, 'title_filter:\n  positive:\n    - analyst\n  notes: "private"\n');
  const r = run(file);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 1, out);
  assert.match(out, /unknown key "notes"/);
});

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});
