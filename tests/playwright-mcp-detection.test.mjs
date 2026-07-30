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

function runDoctor(cwd, args, env) {
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd, ...args], {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message, _stderr: e.stderr ? String(e.stderr) : '' };
  }
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

} catch (e) {
  fail(`opencode-mcp-detection tests crashed: ${e.message}`);
}
