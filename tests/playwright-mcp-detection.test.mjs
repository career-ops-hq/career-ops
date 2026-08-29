// tests/playwright-mcp-detection.test.mjs — CLI-aware Playwright MCP detection
// coverage in `doctor.mjs`. CLI resolution precedence lives in
// tests/doctor-cli-resolution.test.mjs; this file owns the resolution × MCP
// coupling. See plan/opencode-json-ignore.md for context.
// Each scenario uses a fresh --target dir so no MCP config leaks across cases.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
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

function runDoctor(cwd, args, env) {
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd, ...args], {
      cwd,
      // Order matters: the empty dir must override an ambient CLAUDE_CONFIG_DIR
      // from the developer's own shell, while a scenario's explicit env still wins.
      env: { ...process.env, CLAUDE_CONFIG_DIR: EMPTY_CONFIG_DIR, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message, _stderr: e.stderr ? String(e.stderr) : '' };
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

} catch (e) {
  fail(`opencode-mcp-detection tests crashed: ${e.message}`);
} finally {
  rmSync(EMPTY_CONFIG_DIR, { recursive: true, force: true });
}
