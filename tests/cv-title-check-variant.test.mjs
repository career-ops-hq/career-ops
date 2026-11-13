// cv-title-check.mjs --variant <name> (#6792): checks a content variant's
// titles against cv.md. Without the flag nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CV = '## Work Experience\n\n### Acme Corp -- Sydney\n\n**Engineer**\n2020-2024\n\n- Led a team of 3 engineers\n';

function run(args, variants = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-title-var-'));
  writeFileSync(join(dir, 'cv.md'), CV);
  mkdirSync(join(dir, 'data', 'cv-variants'), { recursive: true });
  for (const [f, t] of Object.entries(variants)) writeFileSync(join(dir, 'data', 'cv-variants', f), t);
  return spawnSync(process.execPath, [join(ROOT, 'cv-title-check.mjs'), ...args], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir },
  });
}

test('an inflated variant title is reported with both strings, exit 0 (warn-only)', () => {
  const r = run(['--variant', 'a', '--summary'], { 'a.md': CV.replace('**Engineer**', '**CTO**') });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"Engineer"/);
  assert.match(r.stdout, /"CTO"/);
});

test('a clean variant prints the no-drift line', () => {
  const r = run(['--variant', 'a', '--summary'], { 'a.md': CV });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No title drift/);
});

test('a missing variant exits 1', () => {
  assert.equal(run(['--variant', 'nope']).status, 1);
});
