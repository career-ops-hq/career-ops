// Profile scalar values must be YAML values, not regex fragments.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-prepare-yaml-'));
mkdirSync(join(root, 'config')); mkdirSync(join(root, 'output'));
writeFileSync(join(root, 'output', 'fictional.pdf'), '%PDF-fixture');
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PROFILE: '' };
const run = yaml => {
  writeFileSync(join(root, 'config', 'profile.yml'), yaml);
  return spawnSync(process.execPath, [join(ROOT, 'prepare-application.mjs'), '--url', 'https://boards.greenhouse.io/fictional/jobs/1', '--pdf', 'output/fictional.pdf'], { env, encoding: 'utf8' });
};
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }
try {
  for (const [i, yaml] of ["full_name: \"Alex O'Connor\"\nphone: '+1 555 0100' # private contact\n", "full_name: 'Alex O''Connor'\nphone: +1 555 0100 # private contact\n"].entries()) {
    const r = run(yaml);
    check(`quoted apostrophe name and inline comment decode to exact values (case ${i + 1})`, () => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /first_name\s+Alex\n/);
      assert.match(r.stdout, /last_name\s+O'Connor\n/);
      assert.match(r.stdout, /phone\s+\+1 555 0100\n/);
      assert.ok(!r.stdout.includes('private contact'));
    });
  }
  const plain = run('full_name: Alex Example\nemail: alex@example.invalid\nphone: +1 555 0100\n');
  check('plain scalar YAML retains existing prefill behavior', () => {
    assert.equal(plain.status, 0, plain.stderr); assert.match(plain.stdout, /last_name\s+Example\n/); assert.ok(plain.stdout.includes('alex@example.invalid'));
  });
  const invalid = run('full_name: [unclosed\n');
  check('malformed YAML fails rather than presenting fabricated fields', () => {
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /profile.*YAML/i);
  });
  for (const [key, value] of [['email', '[a, b]'], ['phone', '{x: 1}']]) {
    const r = run(`full_name: Alex Example\n${key}: ${value}\n`);
    check(`${key} rejects a collection instead of prefilling coerced text`, () => {
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes(key));
      assert.ok(r.stderr.includes(join(root, 'config', 'profile.yml')));
      assert.equal(r.stdout, '');
    });
  }
  const scalars = run('full_name: Alex Example\nemail: null\nphone: 5550100\n');
  check('nullish and numeric scalars retain the existing empty and string values', () => {
    assert.equal(scalars.status, 0, scalars.stderr);
    assert.match(scalars.stdout, /phone\s+5550100\n/);
    assert.ok(!scalars.stdout.includes('null'));
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
