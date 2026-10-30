// What you type at `node plugins.mjs` is what runs.
//
// A mistyped flag used to be ignored. `run <id> search "role" --dryrun`
// (one word, the real flag is --dry-run) reached the network. `--help` was
// an unknown command and exited 1. The name in `plugins.mjs available` and
// the word `install` from an approved plugin's own readme were unknown too.
//
// Run: node --test tests/plugins-cli-usage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'plugins.mjs');
const LOCAL_LINKEDIN = join(ROOT, 'plugins.local', 'linkedin-alerts');
// plugins.mjs reads plugins from the checkout it runs from. The cases below
// need linkedin-alerts absent there, and the fixture must never overwrite or
// delete a real install.
const linkedInInstalled = existsSync(LOCAL_LINKEDIN) && 'plugins.local/linkedin-alerts is installed in this checkout';

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 20_000,
    env: { ...process.env, ...env },
  });
  assert.equal(r.error, undefined, describeSpawn(r, args.join(' ')));
  return r;
}

test('plugins.mjs --help prints usage and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, describeSpawn(r, 'help'));
  assert.match(r.stdout, /^Usage: node plugins\.mjs/m);
  assert.equal(r.stderr, '');
});

test('plugins.mjs help is the same message', () => {
  const help = run(['help']);
  const flag = run(['--help']);
  assert.equal(help.status, 0, describeSpawn(help, 'help word'));
  assert.equal(help.stdout, flag.stdout);
});

test('a mistyped dry-run flag is rejected before the plugin runs', () => {
  // apify only has a provider hook, so a flag that is ignored falls through
  // to "run it via scan" and exits 1. The rejection has to name the flag,
  // and it must not continue into that provider message.
  const r = run(['run', 'apify', '--dryrun']);
  assert.equal(r.status, 1, describeSpawn(r, 'dryrun'));
  assert.match(r.stderr, /unrecognized flag\(s\): --dryrun/);
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /provider hook/);
});

test('run --help explains the command instead of asking for a hook', () => {
  const r = run(['run', 'notion', '--help']);
  assert.equal(r.status, 0, describeSpawn(r, 'run help'));
  assert.match(r.stdout, /--dry-run/);
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /multiple hooks|not enabled|Unknown plugin/);
});

test('--sha with no value is an error, not a clone', () => {
  const r = run(['add', '--sha']);
  assert.equal(r.status, 1, describeSpawn(r, 'sha'));
  assert.match(r.stderr, /--sha requires a value/);
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /Cloning/);
});

test('an approved plugin that is not installed tells you the add command', { skip: linkedInInstalled }, () => {
  const r = run(['skill', 'career-ops-plugin-linkedin-alerts']);
  assert.equal(r.status, 1, describeSpawn(r, 'skill long name'));
  assert.match(r.stderr, /approved but not installed/);
  assert.match(r.stderr, /node plugins\.mjs add career-ops-plugin-linkedin-alerts/);
  assert.doesNotMatch(r.stderr, /Unknown plugin/);
});

test('the short id of a plugin that is not installed says the same thing', { skip: linkedInInstalled }, () => {
  const r = run(['skill', 'linkedin-alerts']);
  assert.equal(r.status, 1, describeSpawn(r, 'skill short id'));
  assert.match(r.stderr, /approved but not installed/);
  assert.match(r.stderr, /node plugins\.mjs add /);
});

test('a name that is not a plugin stays unknown', () => {
  const r = run(['skill', 'not-a-real-plugin-zzz']);
  assert.equal(r.status, 1, describeSpawn(r, 'skill unknown'));
  assert.match(r.stderr, /Unknown plugin "not-a-real-plugin-zzz"/);
  assert.doesNotMatch(r.stderr, /not installed/);
});

test('install with no name is the add command, not an unknown command', () => {
  const r = run(['install']);
  assert.equal(r.status, 1, describeSpawn(r, 'install'));
  assert.match(r.stderr, /^Usage: node plugins\.mjs add /m);
  assert.doesNotMatch(r.stderr, /\[list \| available/);
});

test('the registry name reaches an installed plugin', { skip: linkedInInstalled }, (t) => {
  const dir = LOCAL_LINKEDIN;
  const localRoot = join(ROOT, 'plugins.local');
  const createdLocalRoot = !existsSync(localRoot);
  const data = mkdtempSync(join(tmpdir(), 'co-plugin-name-'));
  let createdDir = false;
  try {
    mkdirSync(localRoot, { recursive: true });
    try {
      mkdirSync(dir);
      createdDir = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      t.skip('plugins.local/linkedin-alerts appeared before setup');
      return;
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      id: 'linkedin-alerts',
      name: 'Job alerts',
      version: '0.0.0',
      apiVersion: 1,
      description: 'Fixture plugin for the registry-name command.',
      hooks: ['ingest'],
      humanInTheLoop: true,
    }));
    writeFileSync(join(dir, 'index.mjs'), 'export default { async ingest() { return []; } };\n');
    const r = run(['skill', 'career-ops-plugin-linkedin-alerts'], { CAREER_OPS_ROOT: data });
    assert.equal(r.status, 1, describeSpawn(r, 'installed long name'));
    assert.match(r.stderr, /ships no skill/);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /Unknown plugin|not installed/);
  } finally {
    if (createdLocalRoot) rmSync(localRoot, { recursive: true, force: true, maxRetries: 10 });
    else if (createdDir) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(data, { recursive: true, force: true, maxRetries: 10 });
  }
});
