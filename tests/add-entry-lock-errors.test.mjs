import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../add-entry.mjs', import.meta.url));

for (const failure of ['missing-parent', 'second-lock']) {
  test(`add-entry reports ${failure} errors without changing user files or leaving locks`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-add-lock-error-')));
    const cv = join(root, 'cv.md');
    const digest = join(root, 'article-digest.md');
    const payload = join(root, 'payload.json');
    const preload = join(root, 'fail-lock.mjs');
    const acquired = join(root, 'first-lock-observed');
    const originalCv = '# Fictional CV\n\n## Projects\n\n- Existing project\n';
    const originalDigest = '# Fictional article digest\n';
    try {
      writeFileSync(cv, originalCv);
      writeFileSync(digest, originalDigest);
      writeFileSync(payload, JSON.stringify({
        cv: { section: 'Projects', dedupKey: 'AlphaProject', entry: '- **AlphaProject** — fictional project' },
        articleDigest: { dedupKey: 'AlphaProject', entry: '## AlphaProject -- fictional project\n\nDetails.' },
      }));
      if (failure === 'second-lock') {
        writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const mkdir = fs.mkdirSync;
fs.mkdirSync = function(path, ...args) {
  if (path === ${JSON.stringify(`${cv}.add-entry.lock`)}) {
    if (fs.existsSync(${JSON.stringify(`${digest}.add-entry.lock`)})) {
      fs.writeFileSync(${JSON.stringify(acquired)}, 'first lock acquired');
    }
    throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
  }
  return mkdir.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
      }
      const result = spawnSync(process.execPath, [
        ...(failure === 'second-lock' ? ['--import', pathToFileURL(preload).href] : []),
        cli, payload,
      ], {
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_CV: failure === 'missing-parent' ? join(root, 'missing', 'cv.md') : cv, CAREER_OPS_ARTICLE_DIGEST: digest },
        encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.equal(readFileSync(cv, 'utf8'), originalCv);
      assert.equal(readFileSync(digest, 'utf8'), originalDigest);
      assert.equal(existsSync(`${cv}.add-entry.lock`), false);
      assert.equal(existsSync(`${digest}.add-entry.lock`), false);
      if (failure === 'second-lock') assert.equal(existsSync(acquired), true, 'first lock must have been acquired before the injected failure');
      assert.ok(result.stderr.trim().startsWith('add-entry: '), result.stderr);
      assert.match(result.stderr, failure === 'second-lock' ? /fixture disk full/ : /ENOENT/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
