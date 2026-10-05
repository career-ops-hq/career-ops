// tests/plugin-install-cli-flags.test.mjs — plugin-install.mjs must answer
// --help and reject an unrecognized flag instead of exiting 0 in silence.
//
// docs/SCRIPTS.md lists `node plugin-install.mjs` as a runnable command, but
// the file had no CLI tail at all: every direct invocation — `--help`, `-h`,
// a typo, a repo argument — printed nothing and exited 0. The same
// silent-success class lib/cli-flags.mjs collects the fix for (#2775), and
// the shape stats.mjs already uses.
//
// HERMETIC: every case fails inside the flag gate, so nothing clones, writes
// to plugins.local/, or touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function run(...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'plugin-install.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(r.error, undefined, `plugin-install.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `plugin-install.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('plugin-install.mjs --help exits 0 and prints usage', () => {
  const r = run('--help');
  assert.equal(r.status, 0, `--help exited ${r.status}, want 0`);
  assert.match(r.stdout, /Usage:/, '--help printed no usage block');
});

test('plugin-install.mjs -h exits 0 and prints usage', () => {
  const r = run('-h');
  assert.equal(r.status, 0, `-h exited ${r.status}, want 0`);
  assert.match(r.stdout, /Usage:/, '-h printed no usage block');
});

test('plugin-install.mjs rejects an unrecognized flag', () => {
  const r = run('--nonsense');
  assert.equal(r.status, 1, `--nonsense exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i, 'the unrecognized flag was not reported');
  assert.ok(r.all.includes('--nonsense'), 'the unrecognized flag was not echoed back');
});

// The ordering CodeRabbit caught on #2745/#2746: unknown-flag validation runs
// BEFORE --help short-circuits, or a typo alongside --help exits 0 unreported.
test('plugin-install.mjs --help --bogus still errors', () => {
  const r = run('--help', '--bogus');
  assert.equal(r.status, 1, `--help --bogus exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i);
  assert.doesNotMatch(r.stdout, /Usage:/, '--help was honoured despite the unrecognized flag');
});

// An operand aimed at a command this file does not have (plugins.mjs owns
// `add`/`new`) must not read as a silent success either.
test('plugin-install.mjs rejects a stray operand and names plugins.mjs', () => {
  const r = run('santifer/career-ops-plugin-example');
  assert.equal(r.status, 1, `a stray operand exited ${r.status}, want 1`);
  assert.match(r.stderr, /takes no arguments/i);
  assert.match(r.stderr, /plugins\.mjs/, 'the error did not say where the commands live');
});

// The regression that matters most: plugins.mjs imports this module, so the
// CLI tail must stay behind isMainModule and never fire on import.
test('importing plugin-install.mjs runs no CLI tail', async () => {
  const mod = await import('../plugin-install.mjs');
  assert.equal(typeof mod.installFromRepo, 'function');
  assert.equal(typeof mod.scaffoldNew, 'function');
  assert.equal(typeof mod.parseRepoArg, 'function');
  assert.equal(typeof mod.auditRegistryEntry, 'function');
  assert.equal(typeof mod.safeClone, 'function');
  assert.equal(typeof mod.validateInstall, 'function');
});
