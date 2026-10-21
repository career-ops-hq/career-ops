// plugins split-checkout contract (#3867 finding 3): executable plugin code
// stays in the checkout, while config/plugins.yml and .env live in DATA_ROOT.
//
// Run: node --test tests/plugins-split-root-config.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rmSync, ROOT } from './helpers.mjs';

const PLUGINS_CLI = join(ROOT, 'plugins.mjs');
const NOTION_KEYS = ['NOTION_ACCESS_TOKEN', 'NOTION_PARENT_PAGE_ID'];

function sandbox(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

function runCli(dataRoot, args) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  for (const key of NOTION_KEYS) delete env[key];
  return spawnSync(process.execPath, [PLUGINS_CLI, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

function writeNotionConfig(dir) {
  writeFileSync(join(dir, 'config', 'plugins.yml'), 'plugins:\n  notion:\n    enabled: true\n');
  writeFileSync(
    join(dir, '.env'),
    'NOTION_ACCESS_TOKEN=test-token\nNOTION_PARENT_PAGE_ID=test-parent\n',
  );
}

test('plugins list reads activation and .env from the configured data root', () => {
  const dir = sandbox('career-ops-plugin-list-');
  try {
    writeNotionConfig(dir);
    const result = runCli(dir, ['list']);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stdout, /notion\s+\[export, search\]\s+— ✅ enabled/);
    assert.doesNotMatch(result.stdout + result.stderr, /missing env/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plugins run loads data-root .env before its required-key gate', () => {
  const dir = sandbox('career-ops-plugin-run-');
  try {
    writeNotionConfig(dir);

    // A missing search query exits after the config/env gates but before the
    // hook, integrity lock, or network. That makes this an offline black-box
    // witness for the gate order rather than a source-text assertion.
    const result = runCli(dir, ['run', 'notion', 'search']);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stderr, /search needs a query/);
    assert.doesNotMatch(result.stderr, /not enabled|missing .*\.env/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan preloads .env from the data root instead of the caller cwd', () => {
  const dataRoot = sandbox('career-ops-scan-env-data-');
  const callerRoot = sandbox('career-ops-scan-env-cwd-');
  const key = 'CAREER_OPS_SPLIT_SCAN_ENV_TEST';
  try {
    writeFileSync(join(dataRoot, '.env'), `${key}=from-data-root\n`);
    writeFileSync(join(callerRoot, '.env'), `${key}=from-caller-cwd\n`);
    const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
    delete env[key];
    const scanUrl = pathToFileURL(join(ROOT, 'scan.mjs')).href;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(scanUrl)}); process.stdout.write(process.env[${JSON.stringify(key)}] || '');`],
      { cwd: callerRoot, env, encoding: 'utf-8', timeout: 30_000 },
    );

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.equal(result.stdout, 'from-data-root');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(callerRoot, { recursive: true, force: true });
  }
});

test('plugin activation writes config/plugins.yml under the data root', async () => {
  const dir = sandbox('career-ops-plugin-enable-');
  try {
    const { setPluginEnabled } = await import(
      pathToFileURL(PLUGINS_CLI).href + `?split-root-write=${Date.now()}`
    );
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });

    const file = join(dir, 'config', 'plugins.yml');
    assert.equal(existsSync(file), true);
    const written = readFileSync(file, 'utf-8');
    assert.match(written, /h1b-sponsor:/);
    assert.match(written, /enabled: true/);
    assert.match(written, /region: us/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider engine discovers code in code root and config in data root', async () => {
  const codeRoot = sandbox('career-ops-plugin-code-');
  const dataRoot = sandbox('career-ops-plugin-data-');
  const key = 'CAREER_OPS_SPLIT_PLUGIN_TOKEN';
  const previous = process.env[key];
  try {
    const pluginDir = join(codeRoot, 'plugins', 'split-demo');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'split-demo',
      apiVersion: 1,
      description: 'split-root fixture',
      hooks: ['provider'],
      requiredEnv: [key],
      allowedHosts: ['api.example.com'],
      humanInTheLoop: true,
    }));
    writeFileSync(
      join(pluginDir, 'index.mjs'),
      'export default { provider: { id: "split-demo", async fetch() { return [{ title: "Fixture", url: "https://api.example.com/1" }]; } } };\n',
    );
    writeFileSync(join(dataRoot, 'config', 'plugins.yml'), 'plugins:\n  split-demo:\n    enabled: true\n');
    writeFileSync(join(dataRoot, '.env'), `${key}=from-data-root\n`);
    delete process.env[key];

    const engine = await import(
      pathToFileURL(join(ROOT, 'plugins', '_engine.mjs')).href + `?split-root-engine=${Date.now()}`
    );
    const providers = new Map();
    await engine.mergeProviderPlugins(providers, { root: codeRoot, dataRoot });

    const provider = providers.get('split-demo');
    assert.ok(provider, 'enabled provider from the split roots was not merged');
    assert.equal(process.env[key], 'from-data-root');
    assert.deepEqual(await provider.fetch({}), [{ title: 'Fixture', url: 'https://api.example.com/1' }]);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

// A split checkout set up before this change can still have plugins.yml and
// .env beside the code. They are not read from there (no fallback), so the
// scan path has to say where they belong instead of reading as "no plugins".
const LEFT_IN_CODE = /in the code folder/;

// mergeProviderPlugins in a child, so the warning is checked on the real
// stderr and the providers it merged come back on stdout.
function mergeInChild(codeRoot, dataRoot) {
  const engineUrl = pathToFileURL(join(ROOT, 'plugins', '_engine.mjs')).href;
  const script = [
    `const { mergeProviderPlugins } = await import(${JSON.stringify(engineUrl)});`,
    'const providers = new Map();',
    `await mergeProviderPlugins(providers, { root: ${JSON.stringify(codeRoot)}, dataRoot: ${JSON.stringify(dataRoot)} });`,
    'process.stdout.write(JSON.stringify([...providers.keys()]));',
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: codeRoot,
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

function writeKeylessProvider(codeRoot, id) {
  const pluginDir = join(codeRoot, 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({
    id,
    apiVersion: 1,
    description: 'left-behind fixture',
    hooks: ['provider'],
    humanInTheLoop: true,
  }));
  writeFileSync(
    join(pluginDir, 'index.mjs'),
    `export default { provider: { id: ${JSON.stringify(id)}, async fetch() { return []; } } };\n`,
  );
}

test('split checkout: plugins.yml and .env left in the code root are named with where to move them', () => {
  const codeRoot = sandbox('career-ops-plugin-left-code-');
  const dataRoot = sandbox('career-ops-plugin-left-data-');
  try {
    writeKeylessProvider(codeRoot, 'left-demo');
    writeFileSync(join(codeRoot, 'config', 'plugins.yml'), 'plugins:\n  left-demo:\n    enabled: true\n');
    writeFileSync(join(codeRoot, '.env'), 'CAREER_OPS_LEFT_BEHIND=1\n');

    const result = mergeInChild(codeRoot, dataRoot);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const lines = result.stderr.split('\n').filter(line => LEFT_IN_CODE.test(line));
    const yml = lines.find(line => line.startsWith('⚠️  config/plugins.yml '));
    const env = lines.find(line => line.startsWith('⚠️  .env '));
    assert.ok(yml, `no plugins.yml warning on stderr:\n${result.stderr}`);
    assert.ok(env, `no .env warning on stderr:\n${result.stderr}`);
    assert.ok(yml.includes(join(codeRoot, 'config', 'plugins.yml')), yml);
    assert.ok(yml.includes(join(dataRoot, 'config', 'plugins.yml')), yml);
    assert.ok(env.includes(join(codeRoot, '.env')), env);
    assert.ok(env.includes(join(dataRoot, '.env')), env);
    // .env stays readable beside the code for the eval scripts: copy, not move.
    assert.ok(env.includes('copy the keys your plugins use'), env);
    // A warning, not a fallback: the code-root plugins.yml still enables nothing.
    assert.equal(result.stdout, '[]');
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('split checkout: plugins.yml in the data root raises no left-in-code warning', () => {
  const codeRoot = sandbox('career-ops-plugin-moved-code-');
  const dataRoot = sandbox('career-ops-plugin-moved-data-');
  try {
    // A stale copy in the code root does not matter once the data root has one.
    writeFileSync(join(codeRoot, 'config', 'plugins.yml'), 'plugins: {}\n');
    writeFileSync(join(dataRoot, 'config', 'plugins.yml'), 'plugins: {}\n');

    const result = mergeInChild(codeRoot, dataRoot);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.doesNotMatch(result.stderr, LEFT_IN_CODE);
  } finally {
    rmSync(codeRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('single root: plugins.yml and .env beside the code raise no warning', () => {
  const root = sandbox('career-ops-plugin-one-root-');
  try {
    writeFileSync(join(root, 'config', 'plugins.yml'), 'plugins: {}\n');
    writeFileSync(join(root, '.env'), 'CAREER_OPS_ONE_ROOT=1\n');

    const result = mergeInChild(root, root);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.doesNotMatch(result.stderr, LEFT_IN_CODE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
