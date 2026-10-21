// tests/playwright-mcp-detection.test.mjs — CLI-aware Playwright MCP detection
// coverage in `doctor.mjs`. CLI resolution precedence lives in
// tests/doctor-cli-resolution.test.mjs; this file owns the resolution × MCP
// coupling. See plan/opencode-json-ignore.md for context.
// Each scenario uses a fresh --target dir so no MCP config leaks across cases.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ndoctor.mjs — CLI-aware Playwright MCP detection');

const DOCTOR = join(ROOT, 'doctor.mjs');

// Claude Code can supply an MCP server from an installed plugin, which lives
// under the user's config dir rather than the project root (#2752). Every
// scenario therefore pins CLAUDE_CONFIG_DIR at an EMPTY dir by default, so a
// developer's real machine can never decide the result - the same isolation
// reasoning as the GIT_CONFIG_* pinning in test-all.mjs section 12c (#2569).
// Scenarios that exercise the plugin path pass their own CLAUDE_CONFIG_DIR.
const EMPTY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'co-mcp-emptycfg-'));
// OpenCode resolves its global config from homedir() (USERPROFILE/HOME), so
// default scenarios also need an isolated home: without it, a developer who
// keeps Playwright in their REAL ~/.config/opencode would decide scenario
// #40's "no config anywhere" result — the same "never read the real machine"
// reasoning as the CLAUDE_CONFIG_DIR pin above. Scenarios that WANT a home
// (the user-level-config fixtures) pass their own HOME/USERPROFILE.
const EMPTY_HOME_DIR = mkdtempSync(join(tmpdir(), 'co-mcp-emptyhome-'));

// Ambient runtime markers AND ambient OpenCode config-location overrides from
// the host session (OPENCODE=1 when the suite runs inside OpenCode, plus
// OPENCODE_CONFIG / OPENCODE_CONFIG_DIR / XDG_CONFIG_HOME) are stripped so
// the default scenarios stay deterministic — the same isolation reasoning as
// the CLAUDE_CONFIG_DIR pinning and as the CAREER_OPS_CLI delete in
// doctor-cli-resolution.test.mjs. Scenarios that WANT any of these values
// pass them explicitly via env.
function hostEnv() {
  const {
    OPENCODE: _openCodeMarker,
    OPENCODE_CONFIG: _openCodeConfig,
    OPENCODE_CONFIG_DIR: _openCodeConfigDir,
    XDG_CONFIG_HOME: _xdgConfigHome,
    ...rest
  } = process.env;
  return rest;
}

function runDoctor(cwd, args, env, { executionCwd = cwd } = {}) {
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd, ...args], {
      cwd: executionCwd,
      // Order matters: the empty dirs must override an ambient CLAUDE_CONFIG_DIR
      // / HOME from the developer's own shell, while a scenario's explicit env
      // still wins.
      env: { ...hostEnv(), CLAUDE_CONFIG_DIR: EMPTY_CONFIG_DIR, HOME: EMPTY_HOME_DIR, USERPROFILE: EMPTY_HOME_DIR, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message, _stderr: e.stderr ? String(e.stderr) : '' };
  }
}

function runDoctorHuman(cwd, env, { executionCwd = cwd } = {}) {
  try {
    return execFileSync(NODE, [DOCTOR, '--target', cwd], {
      cwd: executionCwd,
      env: { ...hostEnv(), CLAUDE_CONFIG_DIR: EMPTY_CONFIG_DIR, HOME: EMPTY_HOME_DIR, USERPROFILE: EMPTY_HOME_DIR, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return `${e.stdout ? String(e.stdout) : ''}${e.stderr ? String(e.stderr) : ''}`;
  }
}

// Build a fake Claude Code config dir: settings.json (enabledPlugins) plus
// plugins/installed_plugins.json (installPath per plugin) plus each plugin's
// own .mcp.json - the exact three-file shape doctor resolves.
function makePluginHome({ key, enabled, mcpJson }) {
  const dir = mkdtempSync(join(tmpdir(), 'co-mcp-home-'));
  const installPath = join(dir, 'plugins', 'cache', 'marketplace', 'plugin', 'unknown');
  mkdirSync(installPath, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledPlugins: { [key]: enabled } }));
  writeFileSync(
    join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { [key]: [{ scope: 'user', installPath }] } }),
  );
  if (mcpJson !== null) writeFileSync(join(installPath, '.mcp.json'), mcpJson);
  return dir;
}

function expectWarn(state, msg) {
  if (state._error) { fail(`${msg}: doctor crashed: ${state._error}`); return false; }
  return true;
}

const PLAYWRIGHT_RE = /playwright mcp/i;

try {
  // Split checkout: MCP config lives beside doctor.mjs, while --target points
  // at the user-data root. The CLI never reads a decoy config in that data root.
  {
    const dataRoot = mkdtempSync(join(tmpdir(), 'co-mcp-split-data-'));
    const codeRoot = mkdtempSync(join(tmpdir(), 'co-mcp-split-code-'));
    const codeConfig = join(codeRoot, '.mcp.json');
    try {
      writeFileSync(join(dataRoot, '.mcp.json'), JSON.stringify({
        mcpServers: { unrelated: { command: 'false' } },
      }));
      writeFileSync(codeConfig, JSON.stringify({
        mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } },
      }));
      const state = runDoctor(dataRoot, [], {}, { executionCwd: codeRoot });
      if (state.playwright_mcp?.claude === true
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('split checkout reads Playwright MCP config from code root');
      } else {
        fail(`split checkout ignored code-root MCP config: ${JSON.stringify(state)}`);
      }
      const human = runDoctorHuman(dataRoot, {}, { executionCwd: codeRoot });
      if (/Playwright MCP server configured \(claude\)/.test(human)
          && !/Playwright MCP tools not detected/.test(human)) {
        pass('human doctor output reads Playwright MCP config from code root');
      } else {
        fail(`human doctor output ignored code-root MCP config: ${human}`);
      }
    } finally {
      rmSync(codeRoot, { recursive: true, force: true });
      rmSync(dataRoot, { recursive: true, force: true });
    }
  }

  // 1. Default CLI (no flag/env/.env), no MCP config anywhere → warning fires.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-1-'));
    try {
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#1 default CLI no config')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'default'
          && state.playwright_mcp?.claude === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: claude/i.test(w))) {
        pass('default CLI + no config → warning fires with default-CLI label');
      } else {
        fail(`#1 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 2. .claude/settings.json has Playwright, default CLI is claude → no warning.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-2-'));
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'),
        JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } } }));
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#2 default CLI with Claude config')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'default'
          && state.playwright_mcp?.claude === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('default CLI + Claude config → no warning');
      } else {
        fail(`#2 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 2b. The nixpkgs build of the server (pkgs.playwright-mcp) is configured by
  // its binary name and never mentions the npm package → still detected.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-2b-'));
    try {
      writeFileSync(join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { playwright: { command: 'mcp-server-playwright', args: ['--headless'] } } }));
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#2b nixpkgs mcp-server-playwright')) {
        // already failed
      } else if (state.playwright_mcp?.claude === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('mcp-server-playwright command (nixpkgs build) → detected, no warning');
      } else {
        fail(`#2b unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 3. --cli opencode + opencode.json with Playwright → no warning; source=flag.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-3-'));
    try {
      writeFileSync(join(dir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp@latest'] } } }));
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#3 --cli opencode with config')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'flag'
          && state.playwright_mcp?.opencode === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('--cli opencode + opencode.json → no warning (cli_source=flag)');
      } else {
        fail(`#3 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 4. --cli opencode, no opencode.json → warning with active-CLI label.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-4-'));
    try {
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#4 --cli opencode without config')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'flag'
          && state.playwright_mcp?.opencode === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('--cli opencode without config → warning has active-CLI label');
      } else {
        fail(`#4 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 5. CAREER_OPS_CLI=opencode via env (no flag, no .env), no opencode.json.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-5-'));
    try {
      const state = runDoctor(dir, [], { CAREER_OPS_CLI: 'opencode' });
      if (!expectWarn(state, '#5 env=opencode')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'env'
          && state.playwright_mcp?.opencode === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('CAREER_OPS_CLI env + no config → warning, cli_source=env');
      } else {
        fail(`#5 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 6. .env in --target has CAREER_OPS_CLI=opencode, process.env unset.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-6-'));
    try {
      writeFileSync(join(dir, '.env'), 'CAREER_OPS_CLI=opencode\n');
      const state = runDoctor(dir, [], {});  // no env override
      if (!expectWarn(state, '#6 .env=opencode')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === '.env'
          && state.playwright_mcp?.opencode === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('.env file with CAREER_OPS_CLI → cli_source=.env, warning fires');
      } else {
        fail(`#6 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 7. Both .claude/settings.json and opencode.json have Playwright, no flag/env/.env.
  //    Default Claude is configured → doctor does NOT consult OpenCode → no warning.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-7-'));
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'),
        JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } } }));
      writeFileSync(join(dir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local' } } }));
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#7 dual config + default CLI')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'default'
          && state.playwright_mcp?.claude === true
          && typeof state.playwright_mcp?.opencode === 'undefined'
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('default CLI + Claude config suppresses warning even when opencode.json is present');
      } else {
        fail(`#7 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 8. --cli opencode with only .claude/settings.json present. The active CLI is
  //    opencode; Claude config is irrelevant → warning fires.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-8-'));
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'),
        JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } } }));
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#8 --cli opencode with only Claude config')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'flag'
          && state.playwright_mcp?.opencode === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('--cli opencode with only Claude config → warning (Claude config is irrelevant)');
      } else {
        fail(`#8 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 9. --cli codex → known CLI without MCP scanner; warn (case B).
  //    active_cli is preserved verbatim ("codex"), cli_source='flag',
  //    playwright_mcp is {} (not claude), and the "skipped for CLI: codex"
  //    warning fires — distinct from case A (unknown CLI), which is silent.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-9-'));
    try {
      const state = runDoctor(dir, ['--cli', 'codex'], {});
      if (state._error) { fail(`#9 doctor crashed: ${state._error}`); }
      else if (state.active_cli === 'codex'
          && state.cli_source === 'flag'
          && Object.keys(state.playwright_mcp || {}).length === 0
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => /Playwright MCP check skipped for CLI: codex/i.test(w))) {
        pass('--cli codex → known but unsupported, warn "skipped for CLI: codex"');
      } else {
        fail(`#9 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 10. --cli vim (typo) → resolveActiveCli returns cli='unknown', source='flag'
  //     and emits one warning naming the bad value. MCP check is silent (the
  //     CLI-resolution layer already warned; MCP has nothing to add).
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-10-'));
    try {
      const state = runDoctor(dir, ['--cli', 'vim'], {});
      if (state._error) { fail(`#10 doctor crashed: ${state._error}`); }
      else if (state.active_cli === 'unknown'
          && state.cli_source === 'flag'
          && Object.keys(state.playwright_mcp || {}).length === 0
          && Array.isArray(state.warnings)
          && state.warnings.length === 1
          && /Unknown --cli "vim"/.test(state.warnings[0])) {
        pass('--cli vim → unknown sentinel, one warning naming the bad value');
      } else {
        fail(`#10 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 11. CAREER_OPS_CLI=vim (invalid env) → same as #10 but via env path.
  //     active_cli='unknown', cli_source='env', one warning with the env path.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-11-'));
    try {
      const state = runDoctor(dir, [], { CAREER_OPS_CLI: 'vim' });
      if (state._error) { fail(`#11 doctor crashed: ${state._error}`); }
      else if (state.active_cli === 'unknown'
          && state.cli_source === 'env'
          && Object.keys(state.playwright_mcp || {}).length === 0
          && Array.isArray(state.warnings)
          && state.warnings.length === 1
          && /CAREER_OPS_CLI="vim"/.test(state.warnings[0])) {
        pass('CAREER_OPS_CLI="vim" (invalid) → unknown sentinel, one warning via env path');
      } else {
        fail(`#11 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 12. Pin the warnings[] entry format for the (default-CLI) Playwright MCP
  //     warning so any future text edit fails loudly instead of silently
  //     breaking downstream consumers that key off the prefix/structure.
  //     The format change (Issue #3 in the OpenCode PR review) is a public
  //     contract; this regression test guards it.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-12-'));
    try {
      const state = runDoctor(dir, [], {});
      const mcpWarn = Array.isArray(state.warnings)
        ? state.warnings.find((w) => PLAYWRIGHT_RE.test(w))
        : null;
      if (!mcpWarn) {
        fail('#12 expected a Playwright MCP warning to pin its format');
      } else if (/^Playwright MCP tools not detected \(active CLI: claude\)\n→ /.test(mcpWarn)) {
        pass('warnings[] MCP entry format pinned (label + newline + arrow + hint)');
      } else {
        fail(`#12 unexpected warning format: ${JSON.stringify(mcpWarn)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 13. opencode.json with Playwright under the `mcp` bucket, --cli opencode:
  //     no warning. Pins that the opencode CLI's MCP files are scanned.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-13-'));
    try {
      writeFileSync(join(dir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } } }));
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#13 --cli opencode with .json config')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'flag'
          && state.playwright_mcp?.opencode === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('--cli opencode + opencode.json → no warning');
      } else {
        fail(`#13 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 14. Both `mcpServers` and `mcp` buckets in the same config are unioned.
  //     `mcpServers` is empty (would early-return false on its own), `mcp`
  //     carries the Playwright server. If a future edit changes the bucket
  //     scan to short-circuit on the first non-empty bucket, the opencode-style
  //     `mcp` entry would be silently skipped.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-14-'));
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'),
        JSON.stringify({ mcpServers: {}, mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } } }));
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#14 dual bucket union')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'default'
          && state.playwright_mcp?.claude === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('dual bucket (empty mcpServers + populated mcp) is unioned → no warning');
      } else {
        fail(`#14 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 15. opencode.jsonc with comments AND a trailing comma → detected (#2252).
  //     OpenCode accepts JSONC; JSON.parse throwing on it used to be swallowed
  //     by the catch and reported as "no Playwright MCP server configured".
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-15-'));
    try {
      writeFileSync(join(dir, 'opencode.jsonc'), [
        '{',
        '  // Playwright drives the SPA job boards',
        '  "mcp": {',
        '    "playwright": {',
        '      "type": "local",',
        '      "command": ["npx", "@playwright/mcp", "--headless"], /* inline */',
        '      "enabled": true,',
        '    },',
        '  },',
        '}',
      ].join('\n'));
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#15 opencode.jsonc')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('opencode.jsonc with comments + trailing commas → detected (#2252)');
      } else {
        fail(`#15 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 16. A .json file keeps STRICT parsing: comments there are still malformed,
  //     so the config reads as unconfigured exactly as before. The tolerance is
  //     scoped to the extension that declares it, not granted repo-wide.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-16-'));
    try {
      writeFileSync(join(dir, 'opencode.json'),
        '{\n  // not valid JSON\n  "mcp": { "playwright": { "command": ["npx", "@playwright/mcp"] } }\n}');
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#16 commented .json')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('a commented opencode.json still reads as unconfigured — .json stays strict');
      } else {
        fail(`#16 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 17. opencode.json still wins when both files exist and only it is valid —
  //     adding .jsonc to the list must not shadow the original filename.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-17-'));
    try {
      writeFileSync(join(dir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local', command: ['npx', '@playwright/mcp'] } } }));
      writeFileSync(join(dir, 'opencode.jsonc'), '{ "mcp": {} }');
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#17 both files')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === true
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('opencode.json is still read when an unrelated opencode.jsonc sits next to it');
      } else {
        fail(`#17 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 18. A .jsonc that is malformed beyond comments/trailing commas must stay
  //     unconfigured — the parser tolerates two extensions, it does not guess.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-18-'));
    try {
      writeFileSync(join(dir, 'opencode.jsonc'), '{ "mcp": { "playwright": { "command": [ }');
      const state = runDoctor(dir, ['--cli', 'opencode'], {});
      if (!expectWarn(state, '#18 malformed .jsonc')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('a genuinely malformed opencode.jsonc still reads as unconfigured');
      } else {
        fail(`#18 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // ---------------------------------------------------------------------
  // Plugin-provided MCP servers (#2752). A Claude Code plugin declares its
  // servers in its own .mcp.json under the user config dir, so none of the
  // project-root scenarios above can reach this path. Every case below points
  // CLAUDE_CONFIG_DIR at a synthetic config dir; the project --target stays
  // empty, so a pass can ONLY come from the plugin scan.
  // ---------------------------------------------------------------------
  const PLUGIN_KEY = 'playwright@claude-plugins-official';
  const PLUGIN_MCP = JSON.stringify({ playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } });

  // 19. Enabled plugin whose .mcp.json is a BARE server map → detected.
  //     This is the exact shape the official Playwright plugin ships, and the
  //     case that regressed: doctor reported "not detected" on a machine where
  //     Playwright MCP was installed, enabled and working.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-19-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: true, mcpJson: PLUGIN_MCP });
    try {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#19 enabled plugin')) {
        // already failed
      } else if (state.playwright_mcp?.claude === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('enabled plugin with a bare-map .mcp.json → detected, no warning (#2752)');
      } else {
        fail(`#19 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 20. Installed but NOT enabled → still warns. The manifest is on disk and
  //     the .mcp.json is readable, but a disabled plugin registers no server;
  //     keying off installed_plugins.json alone would pass this wrongly.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-20-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: false, mcpJson: PLUGIN_MCP });
    try {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#20 disabled plugin')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('installed but DISABLED plugin → still warns (installed !== enabled)');
      } else {
        fail(`#20 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 21. Enabled plugin that provides some OTHER MCP server → warns. Guards
  //     against "any enabled plugin with an .mcp.json counts".
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-21-'));
    const home = makePluginHome({
      key: 'notion@some-marketplace',
      enabled: true,
      mcpJson: JSON.stringify({ notion: { command: 'npx', args: ['@notionhq/mcp'] } }),
    });
    try {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#21 unrelated plugin')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('enabled plugin providing a non-Playwright server → still warns');
      } else {
        fail(`#21 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 22. Malformed plugin .mcp.json → reads as unconfigured, no crash. Matches
  //     how a malformed project config is already handled.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-22-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: true, mcpJson: '{ "playwright": { "command": [ }' });
    try {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#22 malformed plugin .mcp.json')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('malformed plugin .mcp.json → unconfigured, doctor does not crash');
      } else {
        fail(`#22 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 23. Enabled plugin whose entry has NO .mcp.json at all → warns, no crash.
  //     Most plugins ship only skills/commands; the file is optional.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-23-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: true, mcpJson: null });
    try {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#23 plugin without .mcp.json')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('enabled plugin with no .mcp.json → warns, no crash');
      } else {
        fail(`#23 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 24. The plugin scan is scoped to CLIs that declare `plugins: true`. With
  //     --cli opencode the very same enabled Playwright plugin must NOT
  //     suppress the warning: OpenCode does not load Claude Code plugins.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-24-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: true, mcpJson: PLUGIN_MCP });
    try {
      const state = runDoctor(dir, ['--cli', 'opencode'], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#24 opencode ignores claude plugins')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('--cli opencode ignores an enabled Claude Code plugin → still warns');
      } else {
        fail(`#24 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 25. An empty config dir (no settings.json, no installed_plugins.json) is
  //     the default every other scenario runs under. Pin that it stays quiet
  //     and warns rather than throwing, so the isolation added for #2752
  //     cannot itself become a crash source on a machine with no plugins.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-25-'));
    const home = mkdtempSync(join(tmpdir(), 'co-mcp-emptyhome-'));
    try {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#25 empty config dir')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('empty CLAUDE_CONFIG_DIR → warns cleanly, no crash');
      } else {
        fail(`#25 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 26. A literal `null` inside a plugin's entry array. This is valid JSON and
  //     a half-written install can leave it behind, so doctor has to survive
  //     it. Destructuring the entry threw a TypeError - `= {}` defaults only
  //     for `undefined`, never for `null` - which killed the run before the
  //     report printed, turning one unconfigured plugin into "career-ops is
  //     broken here". The assertion is that doctor still WARNS: a crash and a
  //     clean miss both leave playwright_mcp false, so only checking the flag
  //     would pass on the bug.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-26-'));
    const home = mkdtempSync(join(tmpdir(), 'co-mcp-nullentry-'));
    try {
      mkdirSync(join(home, 'plugins'), { recursive: true });
      writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true } }));
      writeFileSync(
        join(home, 'plugins', 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: { [PLUGIN_KEY]: [null] } }),
      );
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (state._error) {
        fail(`#26 null plugin entry crashed doctor: ${state._error}`);
      } else if (state.playwright_mcp?.claude === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('null entry in installed_plugins.json → warns cleanly, no crash');
      } else {
        fail(`#26 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 27. Plugin enabled in project .claude/settings.json (not user config) (#3698).
  //     Running `/plugin install playwright@claude-plugins-official` with project
  //     scope writes enabledPlugins to `<project>/.claude/settings.json`.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-27-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: false, mcpJson: PLUGIN_MCP });
    try {
      // Clear user-level enabledPlugins from home/settings.json
      writeFileSync(join(home, 'settings.json'), JSON.stringify({}));
      // Write project-level enabledPlugins
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true } }));

      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#27 project-scoped enabled plugin')) {
        // already failed
      } else if (state.playwright_mcp?.claude === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('project-scoped enabled plugin (.claude/settings.json) → detected, no warning (#3698)');
      } else {
        fail(`#27 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 28. Plugin enabled in project .claude/settings.local.json (#3698).
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-28-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: false, mcpJson: PLUGIN_MCP });
    try {
      writeFileSync(join(home, 'settings.json'), JSON.stringify({}));
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true } }));

      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#28 project-local enabled plugin')) {
        // already failed
      } else if (state.playwright_mcp?.claude === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('project-local enabled plugin (.claude/settings.local.json) → detected, no warning (#3698)');
      } else {
        fail(`#28 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 29. Plugin enabled globally in user config, but explicitly disabled in project (.claude/settings.json) (#3698).
  //     Project config overrides user config.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-29-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: true, mcpJson: PLUGIN_MCP });
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: false } }));

      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#29 project disabled plugin overrides user')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('project-level disable overrides user-level enable → warns (#3698)');
      } else {
        fail(`#29 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 30. Plugin enabled in project .claude/settings.json, but disabled in project .claude/settings.local.json (#3698).
  //     Local project config overrides shared project config.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-30-'));
    const home = makePluginHome({ key: PLUGIN_KEY, enabled: true, mcpJson: PLUGIN_MCP });
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true } }));
      writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: false } }));

      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: home });
      if (!expectWarn(state, '#30 project-local disabled plugin overrides project shared')) {
        // already failed
      } else if (state.playwright_mcp?.claude === false
          && Array.isArray(state.warnings)
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('project-local disable overrides project-shared enable → warns (#3698)');
      } else {
        fail(`#30 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 31-37. `claude mcp add` writes to ~/.claude.json, not to any file in the
  //        checkout (#4392): user scope under the top-level `mcpServers`,
  //        local scope (the default) under `projects[<dir>].mcpServers`. The
  //        file sits at $CLAUDE_CONFIG_DIR/.claude.json when that is set, and
  //        at ~/.claude.json (NOT ~/.claude/.claude.json) otherwise.
  //        Claude Code keys `projects` by the physical path, so the fixtures
  //        use realpathSync: macOS tmpdirs live behind the /var -> /private/var
  //        symlink, and process.cwd() in the child returns the physical one.
  {
    const PW_SERVER = { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} };
    const withClaudeJson = (content, fn) => {
      const dir = mkdtempSync(join(tmpdir(), 'co-mcp-cj-'));
      const cfg = mkdtempSync(join(tmpdir(), 'co-mcp-cjcfg-'));
      try {
        const body = typeof content === 'function' ? content(realpathSync(dir)) : content;
        writeFileSync(join(cfg, '.claude.json'), typeof body === 'string' ? body : JSON.stringify(body));
        fn(dir, cfg);
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(cfg, { recursive: true, force: true });
      }
    };
    const detected = (state) => state.playwright_mcp?.claude === true
      && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w));
    const warned = (state) => state.playwright_mcp?.claude === false
      && state.warnings.some((w) => PLAYWRIGHT_RE.test(w));

    // 31. User scope: top-level mcpServers.
    withClaudeJson({ mcpServers: { playwright: PW_SERVER } }, (dir, cfg) => {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: cfg });
      if (!expectWarn(state, '#31 user scope')) return;
      if (detected(state)) pass('user-scope server in .claude.json → detected (#4392)');
      else fail(`#31 unexpected state: ${JSON.stringify(state)}`);
    });

    // 32. Local scope: projects[<launch dir>].mcpServers, the `claude mcp add` default.
    withClaudeJson((real) => ({ projects: { [real]: { mcpServers: { playwright: PW_SERVER } } } }), (dir, cfg) => {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: cfg });
      if (!expectWarn(state, '#32 local scope')) return;
      if (detected(state)) pass('local-scope server under the launch dir key → detected (#4392)');
      else fail(`#32 unexpected state: ${JSON.stringify(state)}`);
    });

    // 33. Claude Code on Windows stores one directory under two spellings
    //     (C:\... and C:/...) and the local-scope server can sit under either,
    //     while the other entry has no mcpServers. Matching must fold slash
    //     direction and case, and merge every key that matches rather than
    //     stopping at the first hit. The exact-spelling, empty entry comes
    //     first so a first-hit lookup would miss.
    withClaudeJson((real) => ({
      projects: {
        [real]: { mcpServers: {} },
        [real.replace(/\//g, '\\').toUpperCase()]: { mcpServers: { playwright: PW_SERVER } },
      },
    }), (dir, cfg) => {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: cfg });
      if (!expectWarn(state, '#33 dual spelling')) return;
      if (detected(state)) pass('local-scope server under the other slash/case spelling of the launch dir → detected (#4392)');
      else fail(`#33 unexpected state: ${JSON.stringify(state)}`);
    });

    // 34. Malformed .claude.json → unconfigured, no crash.
    withClaudeJson('{ "mcpServers": { "playwright": [ }', (dir, cfg) => {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: cfg });
      if (!expectWarn(state, '#34 malformed .claude.json')) return;
      if (warned(state)) pass('malformed .claude.json → unconfigured, doctor does not crash');
      else fail(`#34 unexpected state: ${JSON.stringify(state)}`);
    });

    // 35. A local-scope server registered for a DIFFERENT project must not count.
    withClaudeJson((real) => ({
      projects: { [`${real}-other`]: { mcpServers: { playwright: PW_SERVER } } },
    }), (dir, cfg) => {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: cfg });
      if (!expectWarn(state, '#35 other project')) return;
      if (warned(state)) pass('local-scope server under another project key → still warns');
      else fail(`#35 unexpected state: ${JSON.stringify(state)}`);
    });

    // 36. Without CLAUDE_CONFIG_DIR the file is ~/.claude.json, beside (not
    //     inside) ~/.claude/. HOME points at a tmpdir, so the real one is never read.
    withClaudeJson({ mcpServers: { playwright: PW_SERVER } }, (dir, cfg) => {
      const state = runDoctor(dir, [], { CLAUDE_CONFIG_DIR: '', HOME: cfg, USERPROFILE: cfg });
      if (!expectWarn(state, '#36 HOME fallback')) return;
      if (detected(state)) pass('no CLAUDE_CONFIG_DIR → reads ~/.claude.json (#4392)');
      else fail(`#36 unexpected state: ${JSON.stringify(state)}`);
    });

    // 37. .claude.json is Claude Code's file; OpenCode never loads it.
    withClaudeJson({ mcpServers: { playwright: PW_SERVER } }, (dir, cfg) => {
      const state = runDoctor(dir, ['--cli', 'opencode'], { CLAUDE_CONFIG_DIR: cfg });
      if (!expectWarn(state, '#37 opencode ignores .claude.json')) return;
      if (state.playwright_mcp?.opencode === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('--cli opencode ignores .claude.json → still warns');
      } else {
        fail(`#37 unexpected state: ${JSON.stringify(state)}`);
      }
    });
  }

  // ---------------------------------------------------------------------
  // OpenCode CLI resolution: runtime marker, checkout hint, and user-level
  // config — the fix for "doctor searches Claude while the MCP server lives
  // in OpenCode" (an OpenCode install reading as claude/unconfigured).
  // ---------------------------------------------------------------------

  // 38. OPENCODE=1 runtime marker, no flag/env/.env, project opencode.json
  //     (in the `mcp.servers` shape OpenCode writes) carries the server.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-38-'));
    try {
      writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
        mcp: { servers: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp@latest'] } } },
      }));
      const state = runDoctor(dir, [], { OPENCODE: '1' });
      if (!expectWarn(state, '#38 OPENCODE marker')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'auto'
          && state.playwright_mcp?.opencode === true
          && Array.isArray(state.warnings)
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('OPENCODE=1 + opencode.json → active_cli=opencode (cli_source=auto), detected, no warning');
      } else {
        fail(`#38 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 39. An explicit CAREER_OPS_CLI still beats the runtime marker: explicit
  //     choice > ambient signal.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-39-'));
    try {
      const state = runDoctor(dir, [], { OPENCODE: '1', CAREER_OPS_CLI: 'claude' });
      if (!expectWarn(state, '#39 env beats marker')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'env'
          && state.playwright_mcp?.claude === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: claude/i.test(w))) {
        pass('CAREER_OPS_CLI=claude beats OPENCODE=1 marker (cli_source=env)');
      } else {
        fail(`#39 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 40. Marker with no config anywhere → warning labeled with the DETECTED
  //     CLI, not the claude default.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-40-'));
    try {
      const state = runDoctor(dir, [], { OPENCODE: '1' });
      if (!expectWarn(state, '#40 marker without config')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'auto'
          && state.playwright_mcp?.opencode === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('OPENCODE=1 without config → warning labels active CLI: opencode (cli_source=auto)');
      } else {
        fail(`#40 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 41. Checkout hint: no runtime marker, but the launch directory carries
  //     opencode.json and NO Claude MCP config → opencode. Plain-shell runs
  //     inside a checkout that is driven from OpenCode resolve correctly too.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-41-'));
    try {
      writeFileSync(join(dir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } } }));
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#41 checkout hint')) {
        // already failed
      } else if (state.active_cli === 'opencode'
          && state.cli_source === 'auto'
          && state.playwright_mcp?.opencode === true
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('opencode.json in launch dir, no Claude config → checkout hint resolves opencode (cli_source=auto)');
      } else {
        fail(`#41 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 42. The hint must NOT fire when a Claude MCP config sits beside it — a
  //     dual-config checkout keeps the historical claude default (#7's rule,
  //     extended to .mcp.json).
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-42-'));
    try {
      writeFileSync(join(dir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local', command: ['npx', '@playwright/mcp'] } } }));
      writeFileSync(join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { unrelated: { command: 'false' } } }));
      const state = runDoctor(dir, [], {});
      if (!expectWarn(state, '#42 dual config keeps claude default')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'default'
          && state.playwright_mcp?.claude === false) {
        pass('.mcp.json beside opencode.json → no hint, claude stays the default');
      } else {
        fail(`#42 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 43. User-level OpenCode config (~/.config/opencode/opencode.json): the
  //     project has no MCP config, but the global one does → detected, same
  //     parity ~/.claude.json already had. HOME/USERPROFILE point the child's
  //     homedir() at a tmpdir; the override env vars are blanked so an
  //     ambient OPENCODE_CONFIG/XDG_CONFIG_HOME cannot decide the result.
  {
    const home = mkdtempSync(join(tmpdir(), 'co-mcp-43home-'));
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-43-'));
    try {
      const cfgDir = join(home, '.config', 'opencode');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(join(cfgDir, 'opencode.json'),
        JSON.stringify({ mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } } }));
      const state = runDoctor(dir, ['--cli', 'opencode'], {
        HOME: home, USERPROFILE: home,
        OPENCODE_CONFIG: '', OPENCODE_CONFIG_DIR: '', XDG_CONFIG_HOME: '',
      });
      if (!expectWarn(state, '#43 user-level opencode config')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === true
          && !state.warnings.some((w) => PLAYWRIGHT_RE.test(w))) {
        pass('global ~/.config/opencode/opencode.json with Playwright → detected, no warning');
      } else {
        fail(`#43 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------------
  // CodeRabbit review follow-up on PR #5105: effective-config semantics.
  // ---------------------------------------------------------------------

  // 44. The runtime marker only counts when it is exactly "1": OPENCODE=0
  //     (a user opting out) keeps the claude default. No opencode.json in
  //     this dir, so the checkout hint cannot fire either.
  {
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-44-'));
    try {
      const state = runDoctor(dir, [], { OPENCODE: '0' });
      if (!expectWarn(state, '#44 OPENCODE=0 keeps default')) {
        // already failed
      } else if (state.active_cli === 'claude'
          && state.cli_source === 'default'
          && state.playwright_mcp?.claude === false) {
        pass('OPENCODE=0 is not a marker → claude stays the default');
      } else {
        fail(`#44 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  // 45. Setting $OPENCODE_CONFIG_DIR must not take the DEFAULT global config
  //     dir out of the scan: OpenCode MERGES config sources — the custom dir
  //     is loaded after the global config and overrides it, it never
  //     replaces it (opencode.ai/docs/config#precedence-order). Two
  //     sub-fixtures pin both directions: (a) Playwright only in the default
  //     global dir + a custom dir set → still detected; (b) Playwright only
  //     in the custom dir → also detected, so the custom dir is scanned too.
  {
    const home = mkdtempSync(join(tmpdir(), 'co-mcp-45home-'));
    const custom = mkdtempSync(join(tmpdir(), 'co-mcp-45custom-'));
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-45-'));
    try {
      const globalCfg = join(home, '.config', 'opencode');
      mkdirSync(globalCfg, { recursive: true });
      const pw = { mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } } };
      writeFileSync(join(globalCfg, 'opencode.json'), JSON.stringify(pw));
      writeFileSync(join(custom, 'opencode.json'),
        JSON.stringify({ mcp: { unrelated: { type: 'local', command: ['x'] } } }));
      const a = runDoctor(dir, ['--cli', 'opencode'],
        { HOME: home, USERPROFILE: home, OPENCODE_CONFIG_DIR: custom });
      const okA = a.playwright_mcp?.opencode === true
        && Array.isArray(a.warnings)
        && !a.warnings.some((w) => PLAYWRIGHT_RE.test(w));
      rmSync(join(globalCfg, 'opencode.json'));
      writeFileSync(join(custom, 'opencode.json'), JSON.stringify(pw));
      const b = runDoctor(dir, ['--cli', 'opencode'],
        { HOME: home, USERPROFILE: home, OPENCODE_CONFIG_DIR: custom });
      const okB = b.playwright_mcp?.opencode === true
        && Array.isArray(b.warnings)
        && !b.warnings.some((w) => PLAYWRIGHT_RE.test(w));
      if (!a._error && !b._error && okA && okB) {
        pass('$OPENCODE_CONFIG_DIR set → default global dir stays scanned (and the custom dir too)');
      } else {
        fail(`#45 unexpected states: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 46. A project-level disable of the INHERITED name wins in the merge:
  //     user config has Playwright, project redefines `playwright` with
  //     enabled:false → OpenCode will not start it → doctor must warn. The
  //     project side uses the `mcp.servers` wrapper shape seen in the wild;
  //     the user side the documented flat shape.
  {
    const home = mkdtempSync(join(tmpdir(), 'co-mcp-46home-'));
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-46-'));
    try {
      const globalCfg = join(home, '.config', 'opencode');
      mkdirSync(globalCfg, { recursive: true });
      writeFileSync(join(globalCfg, 'opencode.json'), JSON.stringify({
        mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } },
      }));
      writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
        mcp: { servers: { playwright: { enabled: false } } },
      }));
      const state = runDoctor(dir, ['--cli', 'opencode'], { HOME: home, USERPROFILE: home });
      if (!expectWarn(state, '#46 project disable wins')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('project enabled:false on the inherited name → merged effective config is unconfigured');
      } else {
        fail(`#46 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 47. Same-name REPLACEMENT: the project redefines `playwright` with a
  //     different, non-Playwright command → the effective entry no longer
  //     references Playwright → warn, even though the user-level file does.
  {
    const home = mkdtempSync(join(tmpdir(), 'co-mcp-47home-'));
    const dir = mkdtempSync(join(tmpdir(), 'co-mcp-47-'));
    try {
      const globalCfg = join(home, '.config', 'opencode');
      mkdirSync(globalCfg, { recursive: true });
      writeFileSync(join(globalCfg, 'opencode.json'), JSON.stringify({
        mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] } },
      }));
      writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
        mcp: { playwright: { type: 'local', command: ['npx', '-y', 'some-other-mcp'] } },
      }));
      const state = runDoctor(dir, ['--cli', 'opencode'], { HOME: home, USERPROFILE: home });
      if (!expectWarn(state, '#47 project replacement wins')) {
        // already failed
      } else if (state.playwright_mcp?.opencode === false
          && state.warnings.some((w) => PLAYWRIGHT_RE.test(w) && /active cli: opencode/i.test(w))) {
        pass('project replaces the inherited name → merged effective config is unconfigured');
      } else {
        fail(`#47 unexpected state: ${JSON.stringify(state)}`);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }

} catch (e) {
  fail(`opencode-mcp-detection tests crashed: ${e.message}`);
} finally {
  rmSync(EMPTY_CONFIG_DIR, { recursive: true, force: true });
  rmSync(EMPTY_HOME_DIR, { recursive: true, force: true });
}
