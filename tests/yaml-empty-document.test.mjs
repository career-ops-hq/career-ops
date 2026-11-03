// tests/yaml-empty-document.test.mjs — a config file holding only comments is
// an empty config, not a parse error.
//
// js-yaml 5 throws "expected a document, but the input is empty" for empty and
// comment-only text, where js-yaml 4 returned undefined. Web Explore writes a
// comment-only portals.yml when no filters are set, so every first-run Explore
// died in scan-ats-full.mjs before reaching a board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { loadYaml } from '../lib/yaml-document.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COMMENT_ONLY = '# Filters for Riverbend Labs\n# title_filter:\n#   positive: []\n';

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'co-yaml-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  return dir;
}

test('loadYaml returns null for text with no YAML content', () => {
  for (const text of ['', '\n\n', '   \t\n', COMMENT_ONLY, '\uFEFF# only a comment\n', '# one\r\n# two\r\n']) {
    assert.equal(loadYaml(text), null, JSON.stringify(text));
  }
});

test('loadYaml parses a document and forwards options', () => {
  assert.deepEqual(loadYaml('# header\ntitle_filter:\n  positive: [platform]\n'), {
    title_filter: { positive: ['platform'] },
  });
  assert.deepEqual(loadYaml('applied: 2026-09-01\n', { schema: yaml.JSON_SCHEMA }), { applied: '2026-09-01' });
});

test('loadYaml still rejects malformed YAML', () => {
  assert.throws(() => loadYaml('title_filter: [unclosed\n'), yaml.YAMLException);
});

test('scan-ats-full sweeps with a comment-only portals.yml', (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, 'portals.yml'), COMMENT_ONLY);
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  // An empty cached directory means no board is fetched, so the run stays offline.
  writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), '[]');
  const result = spawnSync(process.execPath, [join(ROOT, 'scan-ats-full.mjs'), '--ats', 'greenhouse', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
  });
  assert.ifError(result.error);
  assert.doesNotMatch(result.stderr, /expected a document/);
  assert.equal(result.status, 0, describeSpawn(result));
});

test('doctor flags a profile.yml and portals.yml that hold only comments', (t) => {
  const dir = sandbox(t);
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'cv.md'), '# Dana Okafor\n\nPlatform engineer.\n');
  writeFileSync(join(dir, 'config', 'profile.yml'), COMMENT_ONLY);
  writeFileSync(join(dir, 'portals.yml'), COMMENT_ONLY);
  const result = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir, '--json'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_CLI: 'claude' },
  });
  assert.ifError(result.error);
  const state = JSON.parse(result.stdout);
  const empty = state.unpersonalized.filter((u) => /no settings/.test(u.reason)).map((u) => u.path);
  assert.deepEqual(empty, ['config/profile.yml', 'portals.yml']);
});

// Tests parse their own fixtures and may call js-yaml directly. Everything that
// reads a user file goes through loadYaml.
const DIRECT_LOAD = [
  /\byaml\.load\b/,
  /\{[^}]*\bload\b[^}]*\}\s*(?:from\s*|=\s*await\s+import\(\s*)['"]js-yaml['"]/,
];

test('no shipped script calls js-yaml load directly', () => {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '*.mjs', '*.js'], { encoding: 'utf8' })
    .split('\0')
    .filter((p) => p && !p.startsWith('tests/') && !p.startsWith('web/') && p !== 'test-all.mjs' && p !== 'lib/yaml-document.mjs');
  assert.ok(tracked.length > 50, `only ${tracked.length} tracked scripts found`);
  const offenders = tracked.filter((p) => {
    const text = readFileSync(join(ROOT, p), 'utf8');
    return DIRECT_LOAD.some((re) => re.test(text));
  });
  assert.deepEqual(offenders, []);
});

test('the direct-load detector matches every import form in use', () => {
  for (const line of [
    "const doc = yaml.load(raw);",
    "const parseYaml = yaml.load;",
    "import { load as yamlLoad } from 'js-yaml';",
    "import { load, JSON_SCHEMA } from 'js-yaml';",
    "const { load } = await import('js-yaml');",
  ]) {
    assert.ok(DIRECT_LOAD.some((re) => re.test(line)), line);
  }
  assert.ok(!DIRECT_LOAD.some((re) => re.test("import { dump } from 'js-yaml';")));
});
