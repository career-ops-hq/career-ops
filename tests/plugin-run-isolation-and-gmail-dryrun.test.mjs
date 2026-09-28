import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

test('cmdRun result isolation: only the requested plugin id\'s results are collected (#2354)', async () => {
  const { filterResultsForId, loadPlugins, runHook } = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);
  const fakeResults = [
    { id: 'linkedin-alerts', ok: true, result: [{ title: 'Correct', url: 'https://a.test/1' }] },
    { id: 'gmail',           ok: true, result: [{ title: 'Wrong',   url: 'https://b.test/2' }] },
  ];
  // The fix: filterResultsForId restricts the output to only the requested plugin.
  const id = 'linkedin-alerts';
  const found = filterResultsForId(fakeResults, id).filter(r => r.ok && Array.isArray(r.result)).flatMap(r => r.result);
  if (found.length === 1 && found[0].url === 'https://a.test/1') {
    pass('cmdRun result isolation: only the requested plugin id\'s results are collected (#2354)');
  } else {
    fail(`cmdRun result isolation broken: got ${JSON.stringify(found)}`);
    assert.fail(`cmdRun result isolation broken: got ${JSON.stringify(found)}`);
  }

  // Manifest-level pre-invocation filtering test:
  const tmpIsoDir = mkdtempSync(join(tmpdir(), 'co-plugin-iso-'));
  try {
    mkdirSync(join(tmpIsoDir, 'plugins', 'p-one'), { recursive: true });
    mkdirSync(join(tmpIsoDir, 'plugins', 'p-two'), { recursive: true });
    mkdirSync(join(tmpIsoDir, 'config'), { recursive: true });
    writeFileSync(join(tmpIsoDir, 'config', 'plugins.yml'), 'plugins:\n  p-one: { enabled: true }\n  p-two: { enabled: true }\n');

    writeFileSync(join(tmpIsoDir, 'plugins', 'p-one', 'manifest.json'), JSON.stringify({
      id: 'p-one', apiVersion: 1, description: 'Plugin one', humanInTheLoop: true, hooks: ['ingest'], entry: 'index.mjs'
    }));
    writeFileSync(join(tmpIsoDir, 'plugins', 'p-two', 'manifest.json'), JSON.stringify({
      id: 'p-two', apiVersion: 1, description: 'Plugin two', humanInTheLoop: true, hooks: ['ingest'], entry: 'index.mjs'
    }));

    writeFileSync(join(tmpIsoDir, 'plugins', 'p-one', 'index.mjs'), 'export default { ingest: async () => [{ title: "one", url: "https://1.test" }] };');
    writeFileSync(join(tmpIsoDir, 'plugins', 'p-two', 'index.mjs'), 'export default { ingest: async () => { globalThis.__unrelatedPluginInvoked = true; return [{ title: "two", url: "https://2.test" }]; } };');

    globalThis.__unrelatedPluginInvoked = false;
    const loaded = await loadPlugins('ingest', { root: tmpIsoDir, pluginId: 'p-one' });
    const hookResults = await runHook('ingest', null, { root: tmpIsoDir, pluginId: 'p-one' });

    if (loaded.length === 1 && loaded[0].id === 'p-one' && hookResults.length === 1 && hookResults[0].id === 'p-one' && !globalThis.__unrelatedPluginInvoked) {
      pass('runHook pre-filters manifests by pluginId and never invokes unrelated plugins (#2354)');
    } else {
      fail(`runHook did not isolate invocation: loaded=${loaded.map(p => p.id).join(', ')}, invokedUnrelated=${globalThis.__unrelatedPluginInvoked}`);
      assert.fail(`runHook did not isolate invocation: loaded=${loaded.map(p => p.id).join(', ')}, invokedUnrelated=${globalThis.__unrelatedPluginInvoked}`);
    }
  } finally {
    delete globalThis.__unrelatedPluginInvoked;
    try { rmSync(tmpIsoDir, { recursive: true, force: true }); } catch {}
  }
});

test('gmail plugin gates saveProcessedIds behind !ctx.dryRun (#2354)', async () => {
  const gmailMod = await import(pathToFileURL(join(ROOT, 'plugins/gmail/index.mjs')).href);
  const mockCtx = {
    dryRun: true,
    env: { GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z' },
    settings: {},
    fetch: async (url) => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
      if (url.includes('messages?')) return { ok: true, json: async () => ({ messages: [{ id: 'mock-123' }] }) };
      if (url.includes('messages/mock-123')) return {
        ok: true,
        json: async () => ({ payload: { headers: [] } })
      };
      return { ok: true, json: async () => ({}) };
    },
    log: () => {},
  };
  
  // Create a known state file with a non-empty cursor
  const statePath = join(ROOT, 'data', 'gmail-state.json');
  const oldState = existsSync(statePath) ? readFileSync(statePath) : null;
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  const preTestContent = JSON.stringify(['existing-123']);
  writeFileSync(statePath, preTestContent);
  
  const origWarn = console.warn;
  try {
    // Run the ingest logic (suppress expected spoof warning)
    console.warn = () => {};
    await gmailMod.default.ingest(mockCtx);
    
    const newState = readFileSync(statePath, 'utf8');
    if (newState === preTestContent) {
      pass('gmail plugin gates saveProcessedIds behind !ctx.dryRun — dry-run stays dry (#2354)');
    } else {
      fail('gmail plugin calls saveProcessedIds unconditionally — dry-run mutates cursor state (#2354)');
      assert.fail('gmail plugin calls saveProcessedIds unconditionally — dry-run mutates cursor state (#2354)');
    }
  } finally {
    // Always restore console and file state
    console.warn = origWarn;
    if (oldState !== null) writeFileSync(statePath, oldState);
    else rmSync(statePath, { force: true });
  }
});
