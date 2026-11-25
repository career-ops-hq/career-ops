// tests/doctor-cli-resolution.test.mjs — CLI resolution precedence coverage
// in `doctor.mjs`. CLI resolution feeds MCP detection (covered in
// tests/playwright-mcp-detection.test.mjs); this file owns the precedence
// paths themselves. See plan/opencode-json-ignore.md for context.
// Each scenario uses a fresh --target dir so no MCP config / .env / env
// leaks across cases.
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

console.log('\ndoctor.mjs — CLI resolution');

const DOCTOR = join(ROOT, 'doctor.mjs');

function runDoctor(cwd, args, env) {
  const baseEnv = { ...process.env };
  // Hermetic env: in-process imports earlier in the suite load the repo .env
  // (scan.mjs, …), which sets CAREER_OPS_CLI and would silently override the
  // precedence scenarios below. Delete it so each scenario controls the CLI
  // explicitly (default → claude, or the --cli/env/.env value it supplies).
  delete baseEnv.CAREER_OPS_CLI;
  // Same hermetic reasoning for the OpenCode runtime marker: a suite run from
  // inside OpenCode exports OPENCODE=1, which resolveActiveCli now reads as
  // source='auto' → opencode on the default path. Scenarios that WANT the
  // marker pass it explicitly via env.
  delete baseEnv.OPENCODE;
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd, ...args], {
      cwd,
      env: { ...baseEnv, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message, _stderr: e.stderr ? String(e.stderr) : '' };
  }
}

function expectOk(state, msg) {
  if (state._error) { fail(`${msg}: doctor crashed: ${state._error}`); return false; }
  return true;
}

// A directory of executable stand-ins. Doctor must notice them with a PATH
// lookup, not by running them, so the files only need to be executable.
function binDirWith(dir, names, { executable = true } = {}) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    const file = join(bin, process.platform === 'win32' ? `${name}.cmd` : name);
    writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') chmodSync(file, executable ? 0o755 : 0o644);
  }
  return bin;
}

function warningsText(state) {
  return Array.isArray(state.warnings) ? state.warnings.join('\n') : '';
}

try {
  // 1. --cli flag beats process.env.CAREER_OPS_CLI. Pin precedence at the
  //    flag/env boundary so a future reorder of resolveActiveCli fails loudly.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-1-'));
    try {
      const state = runDoctor(dir, ['--cli', 'opencode'], { CAREER_OPS_CLI: 'claude' });
      if (expectOk(state, '#1 flag beats env')
          && state.active_cli === 'opencode'
          && state.cli_source === 'flag') {
        pass('--cli flag beats CAREER_OPS_CLI env (active_cli=opencode, cli_source=flag)');
      } else {
        fail(`#1 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 2. process.env.CAREER_OPS_CLI beats CAREER_OPS_CLI in .env. Pin
  //    precedence at the env/.env boundary.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-2-'));
    try {
      writeFileSync(join(dir, '.env'), 'CAREER_OPS_CLI=claude\n');
      const state = runDoctor(dir, [], { CAREER_OPS_CLI: 'opencode' });
      if (expectOk(state, '#2 env beats .env')
          && state.active_cli === 'opencode'
          && state.cli_source === 'env') {
        pass('process.env CAREER_OPS_CLI beats .env file (active_cli=opencode, cli_source=env)');
      } else {
        fail(`#2 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 3. Nothing on PATH keeps the historical claude default. CI boxes and a
  //    machine with no agent CLI installed must not change.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-3-'));
    try {
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, []) });
      if (expectOk(state, '#3 empty PATH')
          && state.active_cli === 'claude'
          && state.cli_source === 'default') {
        pass('empty PATH keeps active_cli=claude, cli_source=default');
      } else {
        fail(`#3 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source, warnings: state.warnings })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 4. One other CLI on PATH, and no claude, is the CLI doctor should check.
  //    The old default named claude and told the user to install a Claude plugin.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-4-'));
    try {
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, ['grok']) });
      const text = warningsText(state);
      if (expectOk(state, '#4 one CLI on PATH')
          && state.active_cli === 'grok'
          && state.cli_source === 'path'
          && !/claude-plugins-official/.test(text)) {
        pass('only grok on PATH → active_cli=grok, cli_source=path, no Claude plugin advice');
      } else {
        fail(`#4 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source, warnings: state.warnings })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 5. Two other CLIs and no claude: do not guess, and do not name claude.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-5-'));
    try {
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, ['grok', 'codex']) });
      const text = warningsText(state);
      if (expectOk(state, '#5 several CLIs on PATH')
          && state.active_cli === 'unset'
          && state.cli_source === 'path'
          && /codex/.test(text)
          && /grok/.test(text)
          && /remember-cli\.mjs/.test(text)
          && !/claude-plugins-official/.test(text)
          && state.playwright_mcp
          && Object.keys(state.playwright_mcp).length === 0) {
        pass('grok and codex on PATH → unset, names both, no Claude plugin advice');
      } else {
        fail(`#5 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source, playwright_mcp: state.playwright_mcp, warnings: state.warnings })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 6. Antigravity installs as `agy`, not `antigravity`.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-6b-'));
    try {
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, ['agy']) });
      if (expectOk(state, '#6b agy on PATH')
          && state.active_cli === 'antigravity'
          && state.cli_source === 'path') {
        pass('agy on PATH resolves to antigravity');
      } else {
        fail(`#6b unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 7. claude on PATH still wins the default, even beside another CLI.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-6-'));
    try {
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, ['claude', 'grok']) });
      if (expectOk(state, '#6 claude on PATH')
          && state.active_cli === 'claude'
          && state.cli_source === 'default') {
        pass('claude on PATH stays the default beside grok');
      } else {
        fail(`#6 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 8. A file that is not executable is not an installed CLI.
  if (process.platform !== 'win32') {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-7-'));
    try {
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, ['grok'], { executable: false }) });
      if (expectOk(state, '#7 non-executable')
          && state.active_cli === 'claude'
          && state.cli_source === 'default') {
        pass('a non-executable grok file does not count as installed');
      } else {
        fail(`#7 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 9. Flag, env, and the checkout hint stay ahead of PATH.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-8-'));
    try {
      writeFileSync(join(dir, 'opencode.json'), '{}\n');
      const state = runDoctor(dir, [], { PATH: binDirWith(dir, ['grok']) });
      if (expectOk(state, '#8 checkout hint beats PATH')
          && state.active_cli === 'opencode'
          && state.cli_source === 'auto') {
        pass('opencode.json checkout hint beats a grok binary on PATH');
      } else {
        fail(`#8 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // POSIX searches the current directory for an empty PATH component (a
  // leading, trailing, or doubled separator). Windows does not.
  if (process.platform !== 'win32') {
    const dir = mkdtempSync(join(tmpdir(), 'co-resolve-empty-component-'));
    try {
      writeFileSync(join(dir, 'grok'), '#!/bin/sh\nexit 0\n');
      chmodSync(join(dir, 'grok'), 0o755);
      const state = runDoctor(dir, [], { PATH: `${binDirWith(dir, [])}${delimiter}` });
      if (expectOk(state, '#10 empty PATH component')
          && state.active_cli === 'grok'
          && state.cli_source === 'path') {
        pass('a trailing PATH separator finds grok in the current directory');
      } else {
        fail(`#10 unexpected state: ${JSON.stringify({ active_cli: state.active_cli, cli_source: state.cli_source, _error: state._error })}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

} catch (e) {
  fail(`doctor-cli-resolution tests crashed: ${e.message}`);
}
