// Model a privileged cleanup of another user's private CV without requiring sudo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, statSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const refused of [false, true]) {
  test(`cleanup ${refused ? 'preserves the original when ownership restoration is refused' : 'retains the owner of a private CV'}`, { skip: process.platform === 'win32' }, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-owner-')));
    // Keep the hook and its receipt outside the document directory.
    const cv = join(root, 'cv.md');
    const receipt = join(root, 'owner.json');
    const hook = join(root, 'owner.mjs');
    const original = 'Fictional CV\u200b\n';
    try {
      writeFileSync(cv, original);
      chmodSync(cv, 0o600);
      const metadata = statSync(cv);
      const owner = metadata.uid + 1;
      writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const stat = fs.statSync;
fs.statSync = (file, ...args) => {
  const value = stat(file, ...args);
  return String(file) === process.env.OWNER_CV ? Object.assign(value, { uid: value.uid + 1 }) : value;
};
fs.chownSync = (file, uid, gid) => {
  if (process.env.OWNER_REFUSED === 'true') throw Object.assign(new Error('ownership restoration refused'), { code: 'EPERM' });
  fs.writeFileSync(process.env.OWNER_RECEIPT, JSON.stringify({ uid, gid }));
};
syncBuiltinESMExports();
`);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'clean-markers.mjs'), 'clean', cv], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, OWNER_CV: cv, OWNER_RECEIPT: receipt, OWNER_REFUSED: String(refused) },
      });
      assert.equal(result.error, undefined);
      if (refused) {
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /EPERM/);
        assert.equal(readFileSync(cv, 'utf8'), original);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), { uid: owner, gid: metadata.gid });
        assert.equal(readFileSync(cv, 'utf8'), original.replace('\u200b', ''));
        assert.equal(statSync(cv).mode & 0o777, 0o600);
      }
      assert.equal(readdirSync(root).some(name => name.endsWith('.tmp')), false);
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
  });
}
