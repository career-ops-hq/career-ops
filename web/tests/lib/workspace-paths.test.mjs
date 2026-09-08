import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveWorkspacePaths } from '../../src/lib/workspace-paths.mjs';

// Compare the web mirror with the real core resolver in a separate checkout.
// No process-wide environment/cwd mutation and no access to a user's data.
for (const name of ['default', 'data-absolute', 'data-relative', 'root-absolute',
  'root-relative', 'root-wins', 'blank-root', 'marker-absolute', 'marker-relative',
  'empty-marker', 'env-wins-marker']) {
  test(`workspace roots agree with core: ${name}`, () => {
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'co-web-roots-')));
    try {
      const codeRoot = join(sandbox, 'checkout');
      const dataRoot = join(sandbox, 'user data');
      const alternate = join(sandbox, 'other checkout');
      mkdirSync(join(codeRoot, 'web'), { recursive: true });
      mkdirSync(dataRoot);
      mkdirSync(alternate);
      copyFileSync(new URL('../../../path-resolver.mjs', import.meta.url), join(codeRoot, 'path-resolver.mjs'));
      const env = { ...process.env };
      delete env.CAREER_OPS_ROOT;
      delete env.CAREER_OPS_DATA_DIR;
      let expected = codeRoot;
      let expectedCode = codeRoot;
      if (['data-absolute', 'root-absolute', 'root-wins', 'blank-root', 'env-wins-marker'].includes(name)) {
        env.CAREER_OPS_DATA_DIR = dataRoot;
        expected = dataRoot;
      }
      if (name === 'data-relative') {
        env.CAREER_OPS_DATA_DIR = '../user data';
        expected = dataRoot;
      }
      if (['root-absolute', 'root-wins'].includes(name)) {
        env.CAREER_OPS_ROOT = alternate;
        expected = alternate;
        expectedCode = alternate;
      }
      if (name === 'root-relative') {
        env.CAREER_OPS_ROOT = '../other checkout';
        expected = alternate;
        expectedCode = alternate;
      }
      if (name === 'blank-root') env.CAREER_OPS_ROOT = '  ';
      if (['marker-absolute', 'marker-relative', 'empty-marker', 'env-wins-marker'].includes(name)) {
        const marker = name === 'empty-marker' ? ' \n' : name === 'marker-relative' ? '../user data\n' : alternate + '\n';
        writeFileSync(join(codeRoot, '.career-ops-data'), marker);
        if (name === 'marker-relative') expected = dataRoot;
        if (name === 'marker-absolute') expected = alternate;
      }
      const actual = resolveWorkspacePaths({ cwd: join(codeRoot, 'web'), env });
      assert.deepEqual(actual, { codeRoot: expectedCode, dataRoot: expected });
      const script = `import { getCareerOpsRoot } from ${JSON.stringify(pathToFileURL(join(codeRoot, 'path-resolver.mjs')).href)}; process.stdout.write(getCareerOpsRoot());`;
      const core = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: sandbox, env, encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(actual.dataRoot, core);
      assert.equal(actual.dataRoot, resolve(actual.dataRoot));
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
}

test('an unreadable marker is an error, not a fresh empty workspace', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'co-web-roots-error-'));
  try {
    mkdirSync(join(sandbox, 'web'));
    mkdirSync(join(sandbox, '.career-ops-data'));
    assert.throws(() => resolveWorkspacePaths({ cwd: join(sandbox, 'web'), env: {} }), { code: 'EISDIR' });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('changing a marker is observed without a server restart', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'co-web-roots-refresh-'));
  try {
    mkdirSync(join(sandbox, 'web'));
    const options = { cwd: join(sandbox, 'web'), env: {} };
    assert.equal(resolveWorkspacePaths(options).dataRoot, sandbox);
    writeFileSync(join(sandbox, '.career-ops-data'), 'first');
    assert.equal(resolveWorkspacePaths(options).dataRoot, join(sandbox, 'first'));
    writeFileSync(join(sandbox, '.career-ops-data'), 'second');
    assert.equal(resolveWorkspacePaths(options).dataRoot, join(sandbox, 'second'));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
