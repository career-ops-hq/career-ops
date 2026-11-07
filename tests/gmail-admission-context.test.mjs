import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../plugins/_engine.mjs';

test('ingest receives the host admission decision before advancing its cursor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gmail-admission-ctx-'));
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'plugins', 'fixture'), { recursive: true });
    writeFileSync(join(root, 'config/plugins.yml'), 'plugins:\n  fixture: { enabled: true }\n');
    writeFileSync(join(root, 'plugins/fixture/manifest.json'), JSON.stringify({
      id: 'fixture', apiVersion: 1, description: 'Fixture', humanInTheLoop: true, hooks: ['ingest'], entry: 'index.mjs',
    }));
    writeFileSync(join(root, 'plugins/fixture/index.mjs'), `export default {
      ingest: async ctx => ctx.admitJobs([{ title: 'Rejected', url: 'https://example.test/rejected' }]),
    };`);
    let checked;
    const result = await runHook('ingest', null, { root, pluginId: 'fixture', admitJobs: jobs => { checked = jobs; return []; } });
    assert.deepEqual(checked, [{ title: 'Rejected', url: 'https://example.test/rejected' }]);
    assert.equal(result[0].ok, true);
    assert.deepEqual(result[0].result, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
