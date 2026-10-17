// A failed source write must retain the previously confirmed CV/digest.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-add-write-'));
const cv = '# Fictional candidate\n\n## Projects\n\n- Existing proof.\n';
const digest = '# Article Digest\n\n## Existing\n\nConfirmed proof.\n';
const payload = join(root, 'payload.json');
const hook = join(root, 'fail-write.mjs');
// Simulate a partial disk write in a child only, for both direct and temp paths.
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
fs.writeFileSync = (path, data, ...options) => {
  if (String(path).includes(process.env.FAIL_SOURCE)) {
    write(path, Buffer.from(data).subarray(0, 8), ...options);
    throw Object.assign(new Error('fixture disk write failed'), { code: 'EIO' });
  }
  return write(path, data, ...options);
};
syncBuiltinESMExports();\n`);
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_CV: join(root, 'cv.md'), CAREER_OPS_ARTICLE_DIGEST: join(root, 'article-digest.md') };
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }
try {
  for (const source of ['cv.md', 'article-digest.md']) {
    writeFileSync(join(root, 'cv.md'), cv);
    writeFileSync(join(root, 'article-digest.md'), digest);
    const addition = source === 'cv.md'
      ? { cv: { section: 'Projects', dedupKey: 'NewProject', entry: '- **NewProject** — confirmed.' } }
      : { articleDigest: { dedupKey: 'NewArticle', entry: '## NewArticle\n\nConfirmed article.' } };
    writeFileSync(payload, JSON.stringify(addition));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'add-entry.mjs'), payload], { env: { ...env, FAIL_SOURCE: source }, encoding: 'utf8' });
    check(`${source}: failed partial write preserves original bytes`, () => {
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /write failed.*fixture disk write failed/);
      assert.equal(readFileSync(join(root, source), 'utf8'), source === 'cv.md' ? cv : digest);
      assert.equal(readdirSync(root).some(name => name.endsWith('.tmp')), false);
    });
    if (process.platform !== 'win32') chmodSync(join(root, source), 0o600);
    const saved = spawnSync(process.execPath, [join(ROOT, 'add-entry.mjs'), payload], { env, encoding: 'utf8' });
    check(`${source}: successful write persists the addition`, () => {
      assert.equal(saved.status, 0, saved.stderr);
      assert.match(readFileSync(join(root, source), 'utf8'), /New(Project|Article)/);
      if (process.platform !== 'win32') assert.equal(statSync(join(root, source)).mode & 0o777, 0o600);
    });
  }
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
