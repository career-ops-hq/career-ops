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
  try {
    // 4a. doctor without config yields warning
    const resWithoutMcp = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
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

    // 4b. doctor with .omp/mcp.json detects Playwright MCP
    mkdirSync(join(dir, '.omp'), { recursive: true });
    writeFileSync(join(dir, '.omp', 'mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['-y', '@playwright/mcp'],
        },
      },
    }));

    const resWithMcp = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithMcp.active_cli === 'omp'
        && resWithMcp.playwright_mcp?.omp === true
        && !resWithMcp.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor detects Playwright MCP in .omp/mcp.json');
    } else {
      fail(`doctor failed to detect Playwright MCP in .omp/mcp.json: ${JSON.stringify(resWithMcp)}`);
    }

    // 4c. doctor with .omp/.mcp.json detects Playwright MCP
    rmSync(join(dir, '.omp', 'mcp.json'), { force: true });
    writeFileSync(join(dir, '.omp', '.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'mcp-server-playwright',
        },
      },
    }));

    const resWithDotMcp = JSON.parse(execFileSync(NODE, [DOCTOR, '--json', '--target', dir, '--cli', 'omp'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));

    if (resWithDotMcp.playwright_mcp?.omp === true
        && !resWithDotMcp.warnings.some((w) => w.includes('Playwright MCP tools not detected'))) {
      pass('doctor detects Playwright MCP in .omp/.mcp.json');
    } else {
      fail(`doctor failed to detect Playwright MCP in .omp/.mcp.json: ${JSON.stringify(resWithDotMcp)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
