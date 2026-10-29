// Exporting an ATS section must never replace the master CV or profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/export-ats-text.mjs', import.meta.url));
const profile = 'candidate:\n  full_name: Fictional Candidate\n  email: fictional@example.test\n';
const cv = '# Fictional Candidate\n\n## Summary\nA carefully edited master CV.\n\n## Skills\n- Node.js, SQL\n';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-ats-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config/profile.yml'), profile);
  writeFileSync(join(root, 'cv.md'), cv);
  return root;
}
function run(root, args, env = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  const result = spawnSync(process.execPath, [SCRIPT, '--section', 'skills', ...args], {
    cwd: root, env: { ...inherited, CAREER_OPS_ROOT: root, ...env }, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function originalsIntact(root) {
  assert.equal(readFileSync(join(root, 'cv.md'), 'utf8'), cv);
  assert.equal(readFileSync(join(root, 'config/profile.yml'), 'utf8'), profile);
}
for (const [kind, relativePath] of [['cv', 'cv.md'], ['profile', 'config/profile.yml']]) {
  for (const selection of ['default', 'explicit', 'environment']) {
    test(`${selection} ${kind} survives when --out names the input`, t => {
      const root = fixture(t);
      const selected = selection === 'default' ? relativePath : `selected-${kind}.${kind === 'cv' ? 'md' : 'yml'}`;
      const path = join(root, selected);
      writeFileSync(path, kind === 'cv' ? cv : profile);
      const args = ['--out', selected];
      if (selection === 'explicit') args.push(`--${kind}`, path);
      const env = selection === 'environment' ? { [kind === 'cv' ? 'CAREER_OPS_CV' : 'CAREER_OPS_PROFILE']: path } : {};
      const result = run(root, args, env);
      originalsIntact(root);
      assert.equal(readFileSync(path, 'utf8'), kind === 'cv' ? cv : profile);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /overwrite.*(?:profile|CV)/i);
      assert.doesNotMatch(result.stdout, /Wrote ATS/);
    });
  }
  for (const alias of ['hard link', 'symlink']) {
    test(`${kind} survives an output ${alias}`, { skip: alias === 'symlink' && process.platform === 'win32' }, t => {
      const root = fixture(t);
      const output = join(root, 'export.txt');
      (alias === 'hard link' ? linkSync : symlinkSync)(join(root, relativePath), output);
      const result = run(root, ['--out', output]);
      originalsIntact(root);
      assert.equal(result.status, 1, result.stderr);
      if (alias === 'symlink') assert.equal(lstatSync(output).isSymbolicLink(), true);
    });
  }
}
test('separate new and existing exports and stdout preserve both sources', t => {
  const root = fixture(t);
  const output = join(root, 'exports/skills.txt');
  for (const args of [[], ['--out', output], ['--out', output]]) {
    const result = run(root, args);
    assert.equal(result.status, 0, result.stderr);
    originalsIntact(root);
  }
  assert.equal(readFileSync(output, 'utf8'), '--- KEY SKILLS ---\nNode.js, SQL');
});
