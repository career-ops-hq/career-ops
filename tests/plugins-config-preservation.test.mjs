// tests/plugins-config-preservation.test.mjs — enabling or disabling a plugin
// must never destroy config/plugins.yml.
//
// setEnabled()'s own comment states the contract: "merging (never clobbering
// the user's other plugins or non-secret settings)". The merge was only a merge
// if the read succeeded. A swallowed parse error left cfg as {}, and the write
// put that empty object back over the file — every other plugin's enabled state
// and settings gone, including any non-secret value stored there, with nothing
// printed.
//
// What makes it expensive rather than annoying: the trigger is a YAML typo, the
// most likely reason a hand-edited config does not parse and exactly when the
// file most needs not to be replaced; and config/plugins.yml is a USER path in
// update-system.mjs, so there is no copy to restore from.
//
// Tested through parsePluginConfig rather than the CLI. setEnabled resolves its
// path from the SCRIPT's directory, so a CLI-level test would have to write to
// the real checkout's config to exercise anything — the guard is the part with
// the logic, and this reaches it without that.
//
// Run:  node --test tests/plugins-config-preservation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { parsePluginConfig } = await import(pathToFileURL(join(ROOT, 'plugins.mjs')).href);

const FILE = '/somewhere/config/plugins.yml';

// Two plugins and a stored non-secret setting, with one malformed line — the
// shape a typo actually produces.
//
// The malformed line is a TAB in the indentation, chosen because every js-yaml
// version rejects it with the same message. The first version of this fixture
// used a bare `  : value`, which js-yaml 4 throws on and js-yaml 5 happily reads
// as a null key — so the fixture was not malformed at all on CI, the guard was
// never reached, and the suite failed there while passing locally. package.json
// asks for ^5.3.0 and there is no root lockfile, so which major a given
// checkout has is not fixed; a fixture for a parse failure must not depend on
// it. assertFixtureIsMalformed below turns that back into a loud failure if a
// future version ever accepts this too.
const MALFORMED = [
  'plugins:',
  '  apify:',
  '    enabled: true',
  '    settings:',
  '      dataset: KEEP-ME',
  '  gmail:',
  '    enabled: true',
  '\tbroken: this line is indented with a tab',
].join('\n');

// The fixture has one job. If the installed js-yaml parses it, every assertion
// below is vacuous, so say THAT rather than reporting the guard as broken.
test('the fixture is actually unparseable by the installed js-yaml', async () => {
  // `import * as`, not a default import: js-yaml 5 has no default export, and
  // test-all guards the whole repo against that shape.
  const yaml = await import('js-yaml');
  assert.throws(
    () => yaml.load(MALFORMED),
    'the malformed fixture parsed cleanly — it is no longer testing anything. '
    + 'Pick input this js-yaml rejects and re-check the other tests in this file.',
  );
});

test('a malformed config is refused, not silently emptied', () => {
  assert.throws(
    () => parsePluginConfig(MALFORMED, FILE),
    (err) => {
      // The message has to carry both halves: which file, and that nothing was
      // written. "Failed to parse" alone leaves the user unsure whether the
      // enable half-applied.
      assert.match(err.message, /plugins\.yml/, 'the error does not name the file');
      assert.match(err.message, /refusing to overwrite/i, 'the error does not say the file was left alone');
      return true;
    },
  );
});

test('returning {} here is what destroyed the file — pin that it cannot', () => {
  // The regression in one line: before the guard this call returned {}, and
  // setEnabled wrote that back. Anything other than a throw is the bug.
  let returned;
  try {
    returned = parsePluginConfig(MALFORMED, FILE);
  } catch {
    return; // threw — correct
  }
  assert.fail(`parsePluginConfig returned ${JSON.stringify(returned)} for an unparseable config instead of throwing`);
});

test('an absent config is a first enable, not a failure', () => {
  // The guard must not buy safety by breaking the ordinary path.
  assert.deepEqual(parsePluginConfig(null, FILE), {});
});

test('an empty file is treated as absent', () => {
  assert.deepEqual(parsePluginConfig('', FILE), {});
  assert.deepEqual(parsePluginConfig('\n# just a comment\n', FILE), {});
});

test('a well-formed config is returned intact for the merge', () => {
  const cfg = parsePluginConfig('plugins:\n  gmail:\n    enabled: true\n    settings:\n      label: KEEP-ME\n', FILE);
  assert.equal(cfg.plugins.gmail.enabled, true);
  assert.equal(cfg.plugins.gmail.settings.label, 'KEEP-ME', 'an unrelated plugin\'s stored setting did not survive the read');
});

test('valid YAML that is not a mapping is refused too', () => {
  // A scalar or a list parses cleanly and is still not a config. Spreading one
  // into the write would discard it exactly as silently as the empty object.
  for (const raw of ['just a string', '- a\n- b\n', '42']) {
    assert.throws(
      () => parsePluginConfig(raw, FILE),
      /refusing to overwrite/i,
      `a non-mapping config (${JSON.stringify(raw)}) was accepted`,
    );
  }
});

// ── doctor reports it, rather than reading it as "nothing enabled" ──────────
//
// The same swallow lived in doctor.mjs's readPluginConfigSync, which returned
// {} on a parse error. An unreadable config and a config with nothing enabled
// produced the same empty object, so the one tool whose job is to say what is
// wrong answered "off" for every plugin the user had switched on — and said
// nothing about why.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// --target, not CAREER_OPS_ROOT. It is the flag doctor's own existing suite
// uses (tests/doctor-unfilled-templates.test.mjs) and it names the directory
// outright instead of going through env resolution, which the parent process,
// the suite runner and a .career-ops-data marker can all have an opinion about.
// An earlier version of this helper passed the env var and read the target
// correctly on my machine and not on CI's.
function doctorJson(dir) {
  const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--json', '--target', dir], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  const brace = r.stdout.indexOf('{');
  assert.notEqual(brace, -1, `doctor --json printed no JSON. stdout=${JSON.stringify(r.stdout.slice(0, 300))} stderr=${JSON.stringify(r.stderr.slice(0, 300))}`);
  return JSON.parse(r.stdout.slice(brace));
}

// Proves doctor actually looked at the fixture before any assertion reads a
// field off it. Without this, a doctor pointed somewhere else reports a clean
// config and the malformed-config test fails as a bare `undefined` — which says
// nothing about the fixture never having been read.
function assertTargeted(j, dir) {
  const looked = JSON.stringify(j).includes('plugins') || Array.isArray(j.plugins);
  assert.ok(looked, `doctor --json did not report on plugins at all for ${dir}: ${JSON.stringify(j).slice(0, 300)}`);
}

function pluginSandbox(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-doctor-plug-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'plugins.yml'), contents);
  return dir;
}

test('doctor --json distinguishes an unparseable config from an empty one', () => {
  const bad = pluginSandbox(MALFORMED);   // same fixture, same version-independence
  try {
    const j = doctorJson(bad);
    assertTargeted(j, bad);
    assert.ok(
      j.pluginConfigError,
      'doctor reported no parse error for a config that does not parse — '
      + `it either swallowed it or never read ${join(bad, 'config', 'plugins.yml')}`,
    );
    assert.match(String(j.pluginConfigError), /\S/, 'the reported error is empty');
  } finally {
    rmSync(bad, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('and adds no new key on a healthy config', () => {
  // Existing --json consumers must see no change on the ordinary path; the
  // field is the signal that something IS wrong, so its presence has to mean
  // that and only that.
  const good = pluginSandbox('plugins:\n  apify:\n    enabled: true\n');
  try {
    assert.ok(!('pluginConfigError' in doctorJson(good)), 'the error key appears on a healthy config');
  } finally {
    rmSync(good, { recursive: true, force: true, maxRetries: 10 });
  }
});
