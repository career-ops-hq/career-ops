// tests/batch-runner-profile-override.test.mjs — batch-runner.sh resolves the
// profile through path-resolver.mjs, so CAREER_OPS_PROFILE reaches both the
// spend_tier model choice and the personalization injected into the worker
// prompt (#5144).
//
// THE BUG THIS PINS
//
// PROFILE_FILE was built as "$DATA_ROOT/config/profile.yml", while every .mjs
// reader resolves the profile through path-resolver.mjs. A run with
// CAREER_OPS_PROFILE set therefore read the data root's profile for spend_tier
// and for the prompt's personalization: it could launch a different model, and
// hand the worker the wrong candidate profile, than an interactive run.
//
// The model half runs the real script with --dry-run. The prompt half runs it
// with a stub `claude` that captures the resolved system prompt, the same way
// tests/batch-runner-prompt-cache-stability.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const SRC = readFileSync(new URL('../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RESOLVER = readFileSync(new URL('../path-resolver.mjs', import.meta.url), 'utf8');

const DEFAULT_PROFILE = 'spend_tier: economy\ncandidate_note: data-root-profile\n';
const OVERRIDE_PROFILE = 'spend_tier: premium\ncandidate_note: override-profile\n';

// A resolver from before getProfilePath existed. The runner must keep working
// on an install whose preserved path-resolver.mjs lacks the export: the old
// data-root behavior plus a warning, not a dead batch runner.
const LEGACY_RESOLVER = [
  'import { dirname } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'const here = dirname(fileURLToPath(import.meta.url));',
  'export function getCareerOpsRoot() { return here; }',
].join('\n') + '\n';

/** The model a spend tier maps to, read from the script's own table. */
function tierModel(tier) {
  const model = SRC.match(new RegExp(`^\\s*${tier}\\) echo "([^"]+)"`, 'm'))?.[1];
  assert.ok(model, `could not read the ${tier} model out of spend_tier_to_model()`);
  return model;
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// batch-runner.sh prints the resolved path with forward slashes on Windows
// (Git Bash), so the expected path has to be spelled the same way.
const runnerPath = (value) => (process.platform === 'win32' ? value.replace(/\\/g, '/') : value);

/**
 * A throwaway install: batch/ beside path-resolver.mjs, the data root's own
 * config/profile.yml, and a second profile elsewhere that only
 * CAREER_OPS_PROFILE names. `externalDataRoot` puts the data root in a
 * subdirectory, which is what makes the runner append its runtime-path block.
 */
function fixture({ resolver = 'current', externalDataRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-profile-override-'));
  const batchDir = join(dir, 'batch');
  const binDir = join(dir, 'bin');
  const captureDir = join(dir, 'captures');
  const altDir = join(dir, 'alt');
  const dataRoot = externalDataRoot ? join(dir, 'data-root') : dir;
  for (const d of [batchDir, binDir, captureDir, altDir, join(dataRoot, 'config'), join(dataRoot, 'reports'), join(dataRoot, 'data')]) {
    mkdirSync(d, { recursive: true });
  }

  writeFileSync(join(batchDir, 'batch-runner.sh'), SRC);
  chmodSync(join(batchDir, 'batch-runner.sh'), 0o755);
  if (resolver !== 'none') {
    writeFileSync(join(dir, 'path-resolver.mjs'), resolver === 'legacy' ? LEGACY_RESOLVER : RESOLVER);
  }
  writeFileSync(join(dataRoot, 'config', 'profile.yml'), DEFAULT_PROFILE);
  writeFileSync(join(altDir, 'me.yml'), OVERRIDE_PROFILE);

  writeFileSync(join(batchDir, 'batch-prompt.md'), '# Fixture batch worker prompt\n\nURL: {{URL}}\n');
  writeFileSync(join(batchDir, 'batch-input.tsv'), [
    'id\turl\tsource\tnotes',
    '1\thttps://example.com/job\tfixture\t-',
  ].join('\n') + '\n');

  // The worker path, not the dry run: these keep the runner from reaching
  // anything outside the fixture before the stub claude captures the prompt.
  writeFileSync(join(dir, 'reserve-report-num.mjs'), [
    "if (!process.argv.includes('--release')) console.log('001');",
  ].join('\n') + '\n');
  for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
    writeFileSync(join(dir, `${script}.mjs`), '// No external integrations in this fixture.\n');
  }
  writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(join(binDir, 'curl'), 0o755);

  // Captures the file passed via --append-system-prompt-file, then exits
  // non-zero: this test reads the prompt the runner built, not a report.
  writeFileSync(join(binDir, 'claude'), [
    '#!/usr/bin/env bash',
    'promptfile=""',
    'prev=""',
    'for arg in "$@"; do',
    '  if [[ "$prev" == "--append-system-prompt-file" ]]; then',
    '    promptfile="$arg"',
    '  fi',
    '  prev="$arg"',
    'done',
    'if [[ -n "$promptfile" ]]; then cp "$promptfile" "$CAPTURE_DIR/resolved-prompt.md"; fi',
    'exit 1',
  ].join('\n') + '\n');
  chmodSync(join(binDir, 'claude'), 0o755);

  return { dir, batchDir, binDir, captureDir, altDir, dataRoot, runner: join(batchDir, 'batch-runner.sh') };
}

/** Run the fixture runner; `dryRun: false` goes through the worker path with the stub claude. */
function run(f, { profile, dryRun = true, model, careerOpsRoot = f.dataRoot } = {}) {
  const env = {
    ...process.env,
    PATH: `${f.binDir}${delimiter}${process.env.PATH}`,
    CAPTURE_DIR: f.captureDir,
    // tests/helpers.mjs pins CAREER_OPS_ROOT to the suite's sandbox; this
    // fixture's data root is its own directory, so pin it back and leave the
    // profile variable as the only thing that differs between the runs.
    CAREER_OPS_ROOT: careerOpsRoot,
  };
  delete env.CAREER_OPS_DATA_DIR;
  if (profile === undefined) delete env.CAREER_OPS_PROFILE;
  else env.CAREER_OPS_PROFILE = profile;
  const args = ['--parallel', '1', '--max-retries', '0', '--rate-limit-sleep', '0'];
  if (model) args.push('--model', model);
  if (dryRun) args.push('--dry-run');
  const result = spawnSync(getBash(), [f.runner, ...args], {
    cwd: f.dir,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  assert.equal(result.status, 0, describeSpawn(result, `runner exited ${result.status}:\n\n`));
  return result;
}

const modelLine = (result) => (result.stdout.match(/CLI: \S+ \| Model: [^\n]+/) || [])[0] || '';

test('the data root profile is still the default when CAREER_OPS_PROFILE is unset', () => {
  const f = fixture();
  try {
    const result = run(f);
    assert.match(modelLine(result), /spend_tier=economy/, result.stdout);

    // A fresh install has no profile yet and no override; that is not a
    // missing override, so it must not warn about one.
    rmSync(join(f.dir, 'config', 'profile.yml'));
    const fresh = run(f);
    assert.doesNotMatch(fresh.stderr, /no profile at/, fresh.stderr);
    assert.match(modelLine(fresh), /spend_tier=standard/, fresh.stdout);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('CAREER_OPS_PROFILE decides spend_tier and therefore the claude model', () => {
  const f = fixture();
  try {
    const result = run(f, { profile: join(f.altDir, 'me.yml') });
    assert.match(modelLine(result), new RegExp(`${tierModel('premium')} \\(spend_tier=premium\\)`), result.stdout);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('an override that names no file is reported, not silently downgraded', () => {
  const f = fixture();
  try {
    const result = run(f, { profile: join(f.altDir, 'missing.yml') });
    assert.match(result.stderr, /WARN: no profile at .*missing\.yml \(CAREER_OPS_PROFILE\)/, result.stderr);
    assert.match(modelLine(result), /spend_tier=standard/, result.stdout);

    // The warning is not a side effect of resolving spend_tier: an explicit
    // --model skips that read, and the missing profile still has to be said.
    const explicit = run(f, { profile: join(f.altDir, 'missing.yml'), model: 'claude-opus-5-5' });
    assert.match(explicit.stderr, /WARN: no profile at .*missing\.yml/, explicit.stderr);
    assert.match(modelLine(explicit), /explicit --model override/, explicit.stdout);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a resolver without getProfilePath warns and keeps the data root profile', () => {
  const f = fixture({ resolver: 'legacy' });
  try {
    const result = run(f, { profile: join(f.altDir, 'me.yml') });
    assert.match(result.stderr, /WARN: path-resolver\.mjs has no getProfilePath\(\)/, result.stderr);
    assert.match(modelLine(result), /spend_tier=economy/, result.stdout);

    // The override was ignored, so the data-root profile is the one that
    // matters here; a missing one must not be reported as if the variable
    // named it.
    rmSync(join(f.dir, 'config', 'profile.yml'));
    const missing = run(f, { profile: join(f.altDir, 'me.yml') });
    assert.doesNotMatch(missing.stderr, /no profile at .*\(CAREER_OPS_PROFILE\)/, missing.stderr);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a checkout with no resolver warns rather than ignoring the override silently', () => {
  const f = fixture({ resolver: 'none' });
  try {
    const result = run(f, { profile: join(f.altDir, 'me.yml') });
    assert.match(result.stderr, /WARN: no path-resolver\.mjs next to this script/, result.stderr);
    assert.match(modelLine(result), /spend_tier=economy/, result.stdout);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('the worker prompt carries the override profile, not the data root profile', () => {
  const f = fixture();
  try {
    run(f, { profile: join(f.altDir, 'me.yml'), dryRun: false });
    const captured = join(f.captureDir, 'resolved-prompt.md');
    assert.ok(existsSync(captured), 'the stub claude did not capture a resolved system prompt');
    const prompt = readFileSync(captured, 'utf8');
    assert.match(prompt, new RegExp(`The profile for this run is \`${escapeRe(runnerPath(join(f.altDir, 'me.yml')))}\`.`), prompt);
    assert.match(prompt, /Where this prompt names `config\/profile\.yml`, read that file instead/, prompt);
    assert.match(prompt, /candidate_note: override-profile/, prompt);
    assert.doesNotMatch(prompt, /candidate_note: data-root-profile/, 'the prompt still carries the data root profile');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

// Run through a junction (Windows) or a directory symlink, the runner keeps
// that spelling in DATA_ROOT while getProfilePath() returns the real path of
// path-resolver.mjs's directory. Without an override both name the same file,
// so the default layout must not be told about an override nobody set.
// A junction needs no privilege on Windows, but it can still be refused, for
// example when the temp directory sits on a volume that has no junctions; a
// machine that cannot make the link cannot run this case, so it is skipped.
test('a checkout reached through a link gets no Runtime profile block without an override', (t) => {
  const f = fixture();
  const link = `${f.dir}-link`;
  // CAREER_OPS_ROOT names the same directory through a second link, so the
  // profile path the resolver returns differs from DATA_ROOT whichever way the
  // runner spells PROJECT_DIR: the case cannot pass vacuously on a platform
  // where `pwd` happens to give the real path.
  const rootLink = `${f.dir}-root-link`;
  try {
    try {
      symlinkSync(f.dir, link, process.platform === 'win32' ? 'junction' : 'dir');
      symlinkSync(f.dir, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error;
      t.skip(`cannot create a directory link here (${error.code})`);
      return;
    }
    run({ ...f, dir: link, runner: join(link, 'batch', 'batch-runner.sh') }, { dryRun: false, careerOpsRoot: rootLink });
    const captured = join(f.captureDir, 'resolved-prompt.md');
    assert.ok(existsSync(captured), 'the stub claude did not capture a resolved system prompt');
    const prompt = readFileSync(captured, 'utf8');
    assert.doesNotMatch(prompt, /## Runtime profile/, prompt);
    assert.match(prompt, /candidate_note: data-root-profile/, prompt);
  } finally {
    // The links themselves only: removing one recursively would follow it into f.dir.
    rmSync(link, { force: true });
    rmSync(rootLink, { force: true });
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('the runtime-path block names the profile the run actually reads', () => {
  const f = fixture({ externalDataRoot: true });
  try {
    run(f, { profile: join(f.altDir, 'me.yml'), dryRun: false });
    const prompt = readFileSync(join(f.captureDir, 'resolved-prompt.md'), 'utf8');
    assert.match(prompt, /## Runtime paths: data root outside the checkout/, prompt);
    assert.match(prompt, new RegExp(`The profile for this run is \`${escapeRe(runnerPath(join(f.altDir, 'me.yml')))}\``), prompt);
    assert.match(prompt, /Where this prompt names `config\/profile\.yml`, read that file instead/, prompt);
    // The runtime block already names the profile; the default-layout block
    // must not repeat it here.
    assert.doesNotMatch(prompt, /## Runtime profile/, prompt);
    // The block used to list config/profile.yml among the paths to resolve
    // under the data root, which contradicts the override injected below it.
    assert.doesNotMatch(prompt, /`cv\.md`, `article-digest\.md`, `config\/profile\.yml`/, prompt);
    assert.match(prompt, /candidate_note: override-profile/, prompt);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
