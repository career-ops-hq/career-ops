// tests/plugin-ctx-data-root.test.mjs — the plugin engine tells every plugin
// where the user's data root is, through ctx.dataRoot.
//
// The engine was already handed the data root by each of its callers and read
// config/plugins.yml and .env from it, but did not pass it on. A plugin that
// keeps a file of its own had nothing to resolve the path against, so the
// bundled gmail and apify plugins wrote `data/gmail-state.json` and `jds/…`
// relative to the working directory (tests/gmail-state-data-root.test.mjs,
// tests/apify-jds-data-root.test.mjs).
//
// The fixtures are a code root and a data root of their own under the OS temp
// dir, and never the same directory, so a ctx that carried the code root or the
// working directory in place of the data root would fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';
import { buildCtx, runHook, mergeProviderPlugins } from '../plugins/_engine.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const manifest = { id: 'ctx-demo', allowedHosts: [], requiredEnv: [], optionalEnv: [], allowsLocalhost: false };

/** A code root holding one fixture plugin, and a separate data root that enables it. */
function splitRoots(id, hook, indexSource) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-ctx-root-')));
  const codeRoot = join(base, 'code');
  const dataRoot = join(base, 'data-root');
  mkdirSync(join(codeRoot, 'plugins', id), { recursive: true });
  mkdirSync(join(dataRoot, 'config'), { recursive: true });
  writeFileSync(join(codeRoot, 'plugins', id, 'manifest.json'), JSON.stringify({
    id, apiVersion: 1, description: 'ctx.dataRoot fixture', humanInTheLoop: true, hooks: [hook], entry: 'index.mjs',
  }));
  writeFileSync(join(codeRoot, 'plugins', id, 'index.mjs'), indexSource);
  const enable = (root) => {
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(root, 'config', 'plugins.yml'), `plugins:\n  ${id}: { enabled: true }\n`);
  };
  enable(dataRoot);
  return { base, codeRoot, dataRoot, enable };
}

test('buildCtx carries the data root it is given, as an absolute path', () => {
  const ctx = buildCtx(manifest, { dataRoot: join('some', 'relative', 'root') });
  assert.equal(ctx.dataRoot, resolve('some', 'relative', 'root'));
  assert.ok(isAbsolute(ctx.dataRoot));
});

test('a ctx built without a data root gets the one the resolver reports', () => {
  assert.equal(buildCtx(manifest, {}).dataRoot, resolve(getCareerOpsRoot()));
  assert.equal(buildCtx(manifest).dataRoot, resolve(getCareerOpsRoot()));
});

test('runHook hands a hook the data root, not the code root or the working directory', async () => {
  const { base, codeRoot, dataRoot } = splitRoots(
    'ctx-ingest', 'ingest',
    'export default { ingest: async (ctx) => [{ title: "t", url: "https://a.test/1", seen: ctx.dataRoot }] };\n',
  );
  try {
    const [result] = await runHook('ingest', null, { root: codeRoot, dataRoot, pluginId: 'ctx-ingest' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.result[0].seen, dataRoot);
    assert.notEqual(result.result[0].seen, codeRoot);
    assert.notEqual(result.result[0].seen, process.cwd());
    assert.notEqual(result.result[0].seen, ROOT);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('with no separate data root, the code root is the data root', async () => {
  const { base, codeRoot, enable } = splitRoots(
    'ctx-single', 'ingest',
    'export default { ingest: async (ctx) => [{ title: "t", url: "https://a.test/1", seen: ctx.dataRoot }] };\n',
  );
  try {
    enable(codeRoot);
    const [result] = await runHook('ingest', null, { root: codeRoot, pluginId: 'ctx-single' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.result[0].seen, codeRoot);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a provider plugin merged into the scanner gets the data root too', async () => {
  const { base, codeRoot, dataRoot } = splitRoots(
    'ctx-provider', 'provider',
    'export default { provider: { id: "ctx-provider", async fetch(entry, ctx) { return [{ title: "t", url: "https://a.test/1", seen: ctx.dataRoot }]; } } };\n',
  );
  try {
    const providers = new Map();
    await mergeProviderPlugins(providers, { root: codeRoot, dataRoot });
    const provider = providers.get('ctx-provider');
    assert.ok(provider, 'the enabled fixture provider was not merged');
    const [job] = await provider.fetch({ name: 'x' });
    assert.equal(job.seen, dataRoot);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
