// tests/doctor-skill-entrypoint-stubs.test.mjs — doctor.mjs's skill-entrypoint
// stub warning (career-ops#4589).
//
// A checkout without symlink support (core.symlinks=false) writes each per-CLI
// SKILL.md entrypoint as a regular file holding only the symlink target text.
// update-system.mjs apply repairs that, but returns early on an install that is
// already up to date, so a fresh Windows clone never reaches the repair and the
// CLI just loads an empty skill. This pins the doctor check that says so.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ndoctor.mjs — skill entrypoint stubs');

const DOCTOR = join(ROOT, 'doctor.mjs');
const POINTER = '../../../.agents/skills/career-ops/SKILL.md';
const CLAUDE = '.claude/skills/career-ops/SKILL.md';
const CURSOR = '.cursor/skills/career-ops/SKILL.md';

function runDoctor(cwd) {
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message, _stderr: e.stderr ? String(e.stderr) : '' };
  }
}

function put(dir, rel, content) {
  const p = join(dir, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf-8');
  return p;
}

function skillWarning(state) {
  return (state.warnings || []).find((w) => /skill entrypoint/.test(w)) || null;
}

// 1. A pointer-text stub is reported, names the file, and gives the remedy.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-skill-stub-1-'));
  try {
    const stub = put(dir, CLAUDE, POINTER);
    const state = runDoctor(dir);
    const warning = state._error ? null : skillWarning(state);
    if (state._error) {
      fail(`stub run: doctor crashed: ${state._error}`);
    } else if (warning && warning.includes(CLAUDE)) {
      pass('a pointer-text entrypoint stub is surfaced in doctor --json warnings, naming the path');
    } else {
      fail(`stub was not surfaced: ${JSON.stringify(state.warnings)}`);
    }
    if (warning && /materializeSkillEntrypoints/.test(warning) && /update-system\.mjs"? apply/.test(warning)) {
      pass('the warning names both remedies');
    } else {
      fail(`remedy missing from warning: ${JSON.stringify(warning)}`);
    }
    if (warning && warning.indexOf('materializeSkillEntrypoints') < warning.indexOf('update-system.mjs')) {
      pass('direct materialization is listed before apply, which no-ops on an up-to-date clone');
    } else {
      fail(`apply listed before materialization: ${JSON.stringify(warning)}`);
    }
    if (warning && warning.includes(join(dir, 'update-system.mjs')) && warning.includes(pathToFileURL(join(dir, 'scaffolder', 'bin', 'skill-entrypoints.mjs')).href)) {
      pass('both commands are built from the checked root, not the current directory');
    } else {
      fail(`remedy commands are not rooted at the checked checkout: ${JSON.stringify(warning)}`);
    }
    if (readFileSync(stub, 'utf-8') === POINTER) {
      pass('doctor stays read-only: the stub is left untouched');
    } else {
      fail('doctor rewrote the stub; it must only report');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 1b. The printed materialize command works as pasted, from a different
//     directory, against the checkout that was checked.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-skill stub 1b-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'co-skill-elsewhere-'));
  try {
    const canonical = '---\nname: career-ops\n---\nrouter body\n';
    put(dir, '.agents/skills/career-ops/SKILL.md', canonical);
    const mod = join(dir, 'scaffolder', 'bin', 'skill-entrypoints.mjs');
    mkdirSync(dirname(mod), { recursive: true });
    copyFileSync(join(ROOT, 'scaffolder', 'bin', 'skill-entrypoints.mjs'), mod);
    const stub = put(dir, CLAUDE, POINTER);
    const state = runDoctor(dir);
    const warning = state._error ? null : skillWarning(state);
    const cmd = warning && warning.split('\n').map((l) => l.replace(/^\s*→\s*/, '').trim()).find((l) => l.startsWith('node -e'));
    if (!cmd) {
      fail(`no materialize command in warning: ${JSON.stringify(warning)}`);
    } else {
      execFileSync(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-c', cmd], {
        cwd: elsewhere, stdio: 'ignore',
      });
      if (readFileSync(stub, 'utf-8') === canonical) {
        pass('the printed materialize command repairs the checked checkout from another directory (path with a space)');
      } else {
        fail(`stub still holds: ${JSON.stringify(readFileSync(stub, 'utf-8').slice(0, 60))}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
}

// 2. Real skill content and a trailing newline on a real file are not stubs.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-skill-stub-2-'));
  try {
    put(dir, CLAUDE, '---\nname: career-ops\n---\nrouter body\n');
    const state = runDoctor(dir);
    if (state._error) fail(`real file run: doctor crashed: ${state._error}`);
    else if (!skillWarning(state)) pass('an entrypoint holding real skill content raises no warning');
    else fail(`false positive on real content: ${JSON.stringify(state.warnings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. A pointer with a trailing newline still counts as a stub (git on Windows
//    may add one), and the count covers every stub.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-skill-stub-3-'));
  try {
    put(dir, CLAUDE, `${POINTER}\n`);
    put(dir, CURSOR, POINTER);
    const warning = skillWarning(runDoctor(dir));
    if (warning && warning.includes(CLAUDE) && warning.includes(CURSOR) && /^2 CLI skill entrypoints are/.test(warning)) {
      pass('every stub is listed and counted, tolerating a trailing newline');
    } else {
      fail(`multi-stub warning wrong: ${JSON.stringify(warning)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 4. A real symlink is the healthy case on macOS/Linux and must not warn.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-skill-stub-4-'));
  try {
    put(dir, '.agents/skills/career-ops/SKILL.md', 'router body\n');
    const link = join(dir, ...CLAUDE.split('/'));
    mkdirSync(dirname(link), { recursive: true });
    let linked = true;
    try {
      symlinkSync(POINTER, link);
    } catch {
      linked = false;
    }
    if (!linked) {
      pass('symlink case skipped: this filesystem cannot create symlinks');
    } else {
      const state = runDoctor(dir);
      if (state._error) fail(`symlink run: doctor crashed: ${state._error}`);
      else if (!skillWarning(state)) pass('a real symlink entrypoint raises no warning');
      else fail(`false positive on a symlink: ${JSON.stringify(state.warnings)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
