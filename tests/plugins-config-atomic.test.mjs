import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const cjsFs = require('node:fs');
const PLUGINS = new URL('../plugins.mjs', import.meta.url).href;

test('a failed publish leaves the previous plugins.yml and no temp file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-'));
  mkdirSync(join(dir, 'config'));
  try {
    const { setPluginEnabled } = await import(`${PLUGINS}?atomic=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    const file = join(dir, 'config', 'plugins.yml');
    const before = readFileSync(file, 'utf8');
    assert.match(before, /enabled: true/);

    const realRename = cjsFs.renameSync;
    cjsFs.renameSync = () => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
    };
    syncBuiltinESMExports();
    try {
      const again = await import(`${PLUGINS}?atomic-fail=${Date.now()}`);
      assert.throws(
        () => again.setPluginEnabled(dir, 'h1b-sponsor', false),
        /no space/,
      );
      assert.equal(readFileSync(file, 'utf8'), before);
      assert.equal(readdirSync(join(dir, 'config')).some((name) => name.endsWith('.tmp')), false);
    } finally {
      cjsFs.renameSync = realRename;
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
