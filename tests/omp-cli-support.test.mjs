// tests/omp-cli-support.test.mjs — Oh My Pi (omp) CLI support coverage (#4158)
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AGENT_CLIS } from '../lib/agent-cli.mjs';
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';
import { CLI_CANDIDATES, detectCli } from '../rank-pipeline.mjs';

console.log('\n🧪 Testing Oh My Pi (omp) CLI support (#4158)...');

const DOCTOR = join(ROOT, 'doctor.mjs');

// 1. .omp/AGENTS.md content & manifest registration
{
  const ompAgentsPath = join(ROOT, '.omp', 'AGENTS.md');
  if (existsSync(ompAgentsPath)) {
    const content = readFileSync(ompAgentsPath, 'utf8');
    if (content.trim() === '@../AGENTS.md') {
      pass('.omp/AGENTS.md exists and imports @../AGENTS.md');
    } else {
      fail(`.omp/AGENTS.md content mismatch: ${JSON.stringify(content)}`);
    }
  } else {
    fail('.omp/AGENTS.md does not exist');
  }

  if (SYSTEM_PATHS.includes('.omp/AGENTS.md')) {
    pass('.omp/AGENTS.md is registered in SYSTEM_PATHS');
  } else {
    fail('.omp/AGENTS.md missing from SYSTEM_PATHS');
  }
}

// 2. AGENT_CLIS includes omp
{
  if (AGENT_CLIS.includes('omp')) {
    pass('lib/agent-cli.mjs exports omp in AGENT_CLIS');
  } else {
    fail('omp missing from AGENT_CLIS');
  }
}

// 3. rank-pipeline CLI_CANDIDATES includes omp
{
  const ompCandidate = CLI_CANDIDATES.find((c) => c.bin === 'omp');
  if (ompCandidate && JSON.stringify(ompCandidate.args('test')) === JSON.stringify(['--no-tools', '-p', 'test'])) {
    pass('rank-pipeline.mjs CLI_CANDIDATES includes omp with args [--no-tools, -p, prompt]');
  } else {
    fail('rank-pipeline.mjs missing omp candidate or invalid args');
  }
}

// 4. doctor.mjs resolution and MCP detection for omp
{
  const dir = mkdtempSync(join(tmpdir(), 'co-omp-doctor-'));
  const isolatedHome = mkdtempSync(join(tmpdir(), 'co-omp-home-'));
  const isolatedAgentDir = join(isolatedHome, '.omp', 'agent');
  mkdirSync(isolatedAgentDir, { recursive: true });

  const isolatedEnv = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    PI_CODING_AGENT_DIR: isolatedAgentDir,
    OMP_PROFILE: '',
    PI_PROFILE: '',
    CLAUDE_CONFIG_DIR: join(isolatedHome, '.claude'),
  };

  try {
    // 4a. doctor without config yields warning
    const resWithoutMcp = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithoutMcp.active_cli === 'omp'
        && resWithoutMcp.cli_source === 'flag'
        && resWithoutMcp.playwright_mcp?.omp === false
        && resWithoutMcp.warnings.some((w) => w.includes('Playwright MCP tools not detected (active CLI: omp)'))) {
      pass('doctor reports active_cli: omp and warns when .omp/mcp.json is missing');
    } else {
      fail(`doctor unexpectedly handled missing MCP: ${JSON.stringify(resWithoutMcp)}`);
    }

    // 4b. doctor with .omp/mcp.json but native browser enabled warns that server is filtered
    mkdirSync(join(dir, '.omp'), { recursive: true });
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['-y', '@playwright/mcp'],
        },
      },
    }));

    const resFiltered = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resFiltered.active_cli === 'omp'
        && resFiltered.playwright_mcp?.omp === false
        && resFiltered.warnings.some((w) => w.includes('filtered by OMP native browser'))) {
      pass('doctor warns when Playwright MCP in .omp/mcp.json is filtered by native browser');
    } else {
      fail(`doctor failed to report filtered browser MCP: ${JSON.stringify(resFiltered)}`);
    }

    // 4c. doctor with .omp/settings.json disabling browser detects Playwright MCP
    writeFileSync(join(dir, '.omp', 'settings.json'), JSON.stringify({
      browser: {
        enabled: false,
      },
    }));

    const resWithDisabledBrowser = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithDisabledBrowser.active_cli === 'omp'
        && resWithDisabledBrowser.playwright_mcp?.omp === true
        && !resWithDisabledBrowser.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor detects Playwright MCP when .omp/settings.json disables native browser');
    } else {
      fail(`doctor failed with settings.json browser.enabled: false: ${JSON.stringify(resWithDisabledBrowser)}`);
    }

    // 4d. doctor with .omp/.mcp.json and .omp/config.yml detects Playwright MCP
    rmSync(join(dir, '.omp', 'mcp.json'), { force: true });
    rmSync(join(dir, '.omp', 'settings.json'), { force: true });
    writeFileSync(join(dir, '.omp', '.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'mcp-server-playwright',
        },
      },
    }));
    writeFileSync(join(dir, '.omp', 'config.yml'), 'browser:\n  enabled: false\n');

    const resWithDotMcp = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithDotMcp.playwright_mcp?.omp === true
        && !resWithDotMcp.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor detects Playwright MCP in .omp/.mcp.json with config.yml');
    } else {
      fail(`doctor failed with .omp/.mcp.json and config.yml: ${JSON.stringify(resWithDotMcp)}`);
    }

    // 4e. doctor with user-level config disabling native browser
    rmSync(join(dir, '.omp', 'config.yml'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');

    const resWithUserConfig = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithUserConfig.playwright_mcp?.omp === true
        && !resWithUserConfig.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor detects Playwright MCP when user config ($PI_CODING_AGENT_DIR) disables native browser');
    } else {
      fail(`doctor failed with user config: ${JSON.stringify(resWithUserConfig)}`);
    }

    // 4f. doctor with user-level MCP config and disabled browser
    rmSync(join(dir, '.omp', '.mcp.json'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'mcp-server-playwright',
        },
      },
    }));

    const resWithUserMcp = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithUserMcp.playwright_mcp?.omp === true
        && !resWithUserMcp.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor detects Playwright MCP in user-level mcp.json');
    } else {
      fail(`doctor failed with user-level mcp.json: ${JSON.stringify(resWithUserMcp)}`);
    }

    // 4g. doctor with user-level MCP config when native browser is enabled
    rmSync(join(isolatedAgentDir, 'config.yml'), { force: true });

    const resUserMcpFiltered = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resUserMcpFiltered.playwright_mcp?.omp === false
        && resUserMcpFiltered.warnings.some((w) => w.includes('Playwright MCP server defined in the OMP user mcp.json, but filtered by OMP native browser'))) {
      pass('doctor warns when user-level Playwright MCP is filtered by native browser');
    } else {
      fail(`doctor failed to report filtered user-level MCP: ${JSON.stringify(resUserMcpFiltered)}`);
    }

    // 4h. doctor with root fallback mcp.json and disabled browser
    rmSync(join(isolatedAgentDir, 'mcp.json'), { force: true });
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(dir, '.omp', 'config.yml'), 'browser:\n  enabled: false\n');

    const resWithRootFallback = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithRootFallback.playwright_mcp?.omp === true
        && !resWithRootFallback.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor detects Playwright MCP in project-root fallback mcp.json');
    } else {
      fail(`doctor failed with project-root fallback mcp.json: ${JSON.stringify(resWithRootFallback)}`);
    }

    // 4i. doctor respects user-level disabledServers override
    rmSync(join(dir, 'mcp.json'), { force: true });
    rmSync(join(dir, '.omp', 'config.yml'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      disabledServers: ['playwright'],
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resWithDisabledServer = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithDisabledServer.playwright_mcp?.omp === false
        && resWithDisabledServer.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor respects disabledServers in user-level mcp.json');
    } else {
      fail(`doctor failed to respect disabledServers: ${JSON.stringify(resWithDisabledServer)}`);
    }

    // 4j. doctor treats OMP_PROFILE=default as default profile and honors PI_CODING_AGENT_DIR
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resDefaultProfile = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: { ...isolatedEnv, OMP_PROFILE: 'default' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resDefaultProfile.playwright_mcp?.omp === true
        && !resDefaultProfile.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor normalizes OMP_PROFILE=default and honors PI_CODING_AGENT_DIR');
    } else {
      fail(`doctor failed with OMP_PROFILE=default: ${JSON.stringify(resDefaultProfile)}`);
    }

    // 4k. user-level disabledServers suppresses project-defined Playwright server
    rmSync(join(isolatedAgentDir, 'mcp.json'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      disabledServers: ['playwright'],
    }));
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resUserDisabledProjectServer = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resUserDisabledProjectServer.playwright_mcp?.omp === false
        && resUserDisabledProjectServer.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor applies user-level disabledServers across project-level definitions');
    } else {
      fail(`doctor failed to suppress project server with user disabledServers: ${JSON.stringify(resUserDisabledProjectServer)}`);
    }

    // 4l. project-level disabled server (enabled: false) shadows enabled user-level Playwright definition
    rmSync(join(dir, '.omp', 'mcp.json'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { enabled: false, command: 'mcp-server-playwright' },
      },
    }));

    const resProjectDisabledShadows = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resProjectDisabledShadows.playwright_mcp?.omp === false
        && resProjectDisabledShadows.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor respects project-level enabled: false shadowing user-level Playwright server');
    } else {
      fail(`doctor failed when project shadows user server with enabled: false: ${JSON.stringify(resProjectDisabledShadows)}`);
    }

    // 4m. project-level Playwright server overrides user-level disabled server
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { enabled: false, command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resProjectOverridesUserDisabled = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resProjectOverridesUserDisabled.playwright_mcp?.omp === true
        && !resProjectOverridesUserDisabled.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor respects project-level Playwright server overriding user-level disabled definition');
    } else {
      fail(`doctor failed when project overrides user-level disabled server: ${JSON.stringify(resProjectOverridesUserDisabled)}`);
    }

    // 4n. user-level Playwright definition shadows root fallback mcp.json disabled definition
    rmSync(join(dir, '.omp', 'mcp.json'), { force: true });
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { enabled: false, command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resUserOverridesRootFallback = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resUserOverridesRootFallback.playwright_mcp?.omp === true
        && !resUserOverridesRootFallback.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor respects user-level Playwright server overriding root fallback mcp.json');
    } else {
      fail(`doctor failed when user overrides root fallback mcp.json: ${JSON.stringify(resUserOverridesRootFallback)}`);
    }

    // 4o. active-profile enabledServers force-enables a project-level disabled server
    rmSync(join(dir, 'mcp.json'), { force: true });
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { enabled: false, command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      enabledServers: ['playwright'],
    }));

    const resForcedEnabled = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resForcedEnabled.playwright_mcp?.omp === true
        && !resForcedEnabled.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor respects active-profile enabledServers force-enabling disabled server');
    } else {
      fail(`doctor failed with active-profile enabledServers: ${JSON.stringify(resForcedEnabled)}`);
    }

    // 4p. disabledServers takes precedence over enabledServers when both present
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      enabledServers: ['playwright'],
      disabledServers: ['playwright'],
    }));

    const resDisabledWins = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resDisabledWins.playwright_mcp?.omp === false
        && resDisabledWins.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor gives disabledServers precedence over enabledServers in user config');
    } else {
      fail(`doctor failed to prioritize disabledServers over enabledServers: ${JSON.stringify(resDisabledWins)}`);
    }

    // 4q. user .mcp.json is not an override source (disabledServers only read from active mcp.json)
    rmSync(join(dir, '.omp', 'mcp.json'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    writeFileSync(join(isolatedAgentDir, '.mcp.json'), JSON.stringify({
      disabledServers: ['playwright'],
    }));
    writeFileSync(join(isolatedAgentDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resDotMcpNotOverride = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resDotMcpNotOverride.playwright_mcp?.omp === true
        && !resDotMcpNotOverride.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor reads disabledServers only from active user mcp.json, not .mcp.json');
    } else {
      fail(`doctor failed to ignore disabledServers in .mcp.json: ${JSON.stringify(resDotMcpNotOverride)}`);
    }

    // 4r. mcp.enableProjectConfig: false disables project MCP sources
    rmSync(join(isolatedAgentDir, 'mcp.json'), { force: true });
    rmSync(join(isolatedAgentDir, '.mcp.json'), { force: true });
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(dir, '.omp', 'settings.json'), JSON.stringify({
      mcp: { enableProjectConfig: false },
    }));

    const resProjectMcpDisabled = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resProjectMcpDisabled.playwright_mcp?.omp === false
        && resProjectMcpDisabled.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor respects mcp.enableProjectConfig: false and excludes project MCP sources');
    } else {
      fail(`doctor failed when mcp.enableProjectConfig is false: ${JSON.stringify(resProjectMcpDisabled)}`);
    }

    // 4s. OMP discovers Playwright MCP from Claude project config (.claude/mcp.json)
    rmSync(join(dir, '.omp', 'mcp.json'), { force: true });
    rmSync(join(dir, '.omp', 'settings.json'), { force: true });
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resClaudeImported = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resClaudeImported.playwright_mcp?.omp === true
        && !resClaudeImported.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor discovers Playwright MCP for OMP from imported Claude project config');
    } else {
      fail(`doctor failed to discover Playwright MCP from Claude config: ${JSON.stringify(resClaudeImported)}`);
    }

    // 4t. Claude project config overrides root fallback mcp.json
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { enabled: false, command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(dir, '.claude', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));

    const resClaudeOverridesRootFallback = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resClaudeOverridesRootFallback.playwright_mcp?.omp === true
        && !resClaudeOverridesRootFallback.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor prioritizes Claude project MCP over root fallback mcp.json');
    } else {
      fail(`doctor failed when Claude project config overrides root fallback: ${JSON.stringify(resClaudeOverridesRootFallback)}`);
    }

    // 4u. disabledProviders takes precedence over enabledProviders across config layers
    rmSync(join(dir, 'mcp.json'), { force: true });
    rmSync(join(dir, '.claude'), { recursive: true, force: true });
    rmSync(join(isolatedAgentDir, 'mcp.json'), { force: true });
    rmSync(join(isolatedAgentDir, '.mcp.json'), { force: true });
    mkdirSync(join(isolatedHome, '.claude'), { recursive: true });
    writeFileSync(join(isolatedHome, '.claude', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));
    mkdirSync(join(dir, '.omp'), { recursive: true });
    writeFileSync(join(dir, '.omp', 'settings.json'), JSON.stringify({
      enabledProviders: ['claude'],
    }));
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\ndisabledProviders:\n  - claude\n');

    const resDisabledProvidersWins = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: isolatedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resDisabledProvidersWins.playwright_mcp?.omp === false
        && resDisabledProvidersWins.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor respects disabledProviders over enabledProviders across config layers');
    } else {
      fail(`doctor failed when disabledProviders should win: ${JSON.stringify(resDisabledProvidersWins)}`);
    }

    // Removing user disabledProviders allows project enabledProviders to discover Claude MCP
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');

    const resEnabledProvidersActive = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: { ...isolatedEnv, CLAUDE_CONFIG_DIR: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resEnabledProvidersActive.playwright_mcp?.omp === true
        && !resEnabledProvidersActive.warnings.some((w) => w.includes('Playwright MCP'))) {
      pass('doctor discovers Claude user MCP when enabledProviders is active without disabledProviders');
    } else {
      fail(`doctor failed when enabledProviders is active without disabledProviders: ${JSON.stringify(resEnabledProvidersActive)}`);
    }

    // 4v. doctor ignores inactive .omp/config.yaml in project settings
    rmSync(join(dir, 'mcp.json'), { force: true });
    rmSync(join(dir, '.claude'), { recursive: true, force: true });
    rmSync(join(isolatedAgentDir, 'mcp.json'), { force: true });
    rmSync(join(isolatedAgentDir, '.mcp.json'), { force: true });
    mkdirSync(join(isolatedHome, '.claude'), { recursive: true });
    writeFileSync(join(isolatedHome, '.claude', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'mcp-server-playwright' },
      },
    }));
    writeFileSync(join(isolatedAgentDir, 'config.yml'), 'browser:\n  enabled: false\n');
    mkdirSync(join(dir, '.omp'), { recursive: true });
    writeFileSync(join(dir, '.omp', 'config.yaml'), 'disabledProviders: []\n');
    writeFileSync(join(dir, '.omp', 'settings.json'), JSON.stringify({
      disabledProviders: ['claude'],
      enabledProviders: ['claude'],
    }));

    const resIgnoreProjectConfigYaml = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      env: { ...isolatedEnv, CLAUDE_CONFIG_DIR: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resIgnoreProjectConfigYaml.playwright_mcp?.omp === false
        && resIgnoreProjectConfigYaml.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor ignores inactive .omp/config.yaml and respects .omp/settings.json disabledProviders');
    } else {
      fail(`doctor failed to ignore inactive project config.yaml: ${JSON.stringify(resIgnoreProjectConfigYaml)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(isolatedHome, { recursive: true, force: true });
  }
}


