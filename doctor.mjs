#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for career-ops
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import { discoverPlugins, pluginRoots, pluginStatus } from './plugins/_engine.mjs';
import { resolveExtractorMode } from './browser-extract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const targetIdx = argv.indexOf('--target');
const projectRoot =
  targetIdx !== -1 && argv[targetIdx + 1] ? argv[targetIdx + 1] : __dirname;
const JSON_OUT = argv.includes('--json');
// --strict adds a live ATS-slug probe of portals.yml (network). Opt-in so the
// default `npm run doctor` stays fast and fully offline.
const STRICT = argv.includes('--strict');

// CLIs the doctor recognises.
const VALID_CLIS = ['claude', 'codex', 'opencode', 'antigravity', 'grok', 'qwen', 'kimi', 'copilot', 'gemini'];

const cliIdx = argv.indexOf('--cli');
const cliFlag = cliIdx !== -1 ? argv[cliIdx + 1] : null;

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yellow = (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const versionStr = process.versions.node;
  const [major, minor] = versionStr.split('.').map(Number);
  const hasSqlite = major > 22 || (major === 22 && minor >= 5);

  if (hasSqlite) {
    return { pass: true, label: `Node.js >= 22.5 (v${versionStr})` };
  }

  if (major >= 18) {
    return {
      warn: true,
      label: `Node.js v${versionStr} detected. Node >= 22.5.0 is highly recommended because tracker.mjs (SQLite database indexing) requires node:sqlite.`,
      fix: [
        'Upgrade Node.js to v22.5.0 or later to enable full tracker database support.',
        'The markdown tracker keeps working without it — the index is optional.',
      ],
    };
  }

  return {
    pass: false,
    label: `Node.js >= 18 (found v${versionStr})`,
    fix: 'Install Node.js 22.5.0 or later from https://nodejs.org',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
  // Validate by launching — chromium.executablePath() points at Chrome for Testing
  // (full binary) but chromium.launch() may use the headless-shell binary, which
  // lives at a different path and requires a separate install. Launching directly
  // tests the exact binary the runtime uses and catches stub-installs (directory
  // present but no binary — just ABOUT + LICENSE files).
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    return { pass: true, label: 'Playwright chromium installed' };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

// Per-CLI MCP config registry.
const MCP_CONFIGS = [
  { cli: 'claude',   files: ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'] },
  { cli: 'opencode', files: ['opencode.json'] },
];

// Server qualifies if its definition references the @playwright/mcp package.
function isPlaywrightServer(server) {
  if (!server || typeof server !== 'object') return false;
  const blob = JSON.stringify(server).toLowerCase();
  return blob.includes('@playwright/mcp');
}

function isPlaywrightMcpConfigured(root, activeCli) {
  const entry = MCP_CONFIGS.find((c) => c.cli === activeCli);
  if (!entry) return false; // known CLI but no MCP file mapping; caller warns
  return entry.files.some((rel) => {
    const file = join(root, ...rel.split('/'));
    if (!existsSync(file)) return false;
    try {
      const cfg = JSON.parse(readFileSync(file, 'utf8')) ?? {};
      const buckets = [cfg.mcpServers, cfg.mcp].filter((b) => b && typeof b === 'object');
      return buckets.some((servers) => Object.values(servers).some(isPlaywrightServer));
    } catch {
      // Malformed config — treat as unconfigured, keep silent (matches prior behavior).
    }
    return false;
  });
}

// CLI resolution: --cli flag > $CAREER_OPS_CLI > .env (CAREER_OPS_CLI=...) >
// default ('claude'). An unknown value at ANY level returns the sentinel
// 'unknown' and produces no output — CLI-dependent checks are silently
// skipped. .env parsing is best-effort: missing file is normal, malformed
// values are caught per call below.
function resolveActiveCli() {
  if (cliFlag !== undefined && cliFlag !== null) {
    if (!VALID_CLIS.includes(cliFlag)) {
      return { cli: 'unknown', source: 'flag', warning: `Unknown --cli "${cliFlag}". Valid: ${VALID_CLIS.join(', ')}.` };
    }
    return { cli: cliFlag, source: 'flag' };
  }
  if (process.env.CAREER_OPS_CLI) {
    if (!VALID_CLIS.includes(process.env.CAREER_OPS_CLI)) {
      return { cli: 'unknown', source: 'env', warning: `CAREER_OPS_CLI="${process.env.CAREER_OPS_CLI}" is not a recognized CLI. Valid: ${VALID_CLIS.join(', ')}.` };
    }
    return { cli: process.env.CAREER_OPS_CLI, source: 'env' };
  }
  // .env is best-effort: missing file → fall through to default. dotenv does
  // not throw on a missing path when `quiet: true`, so no try/catch is needed.
  dotenv.config({ path: join(projectRoot, '.env'), quiet: true });
  if (process.env.CAREER_OPS_CLI) {
    if (!VALID_CLIS.includes(process.env.CAREER_OPS_CLI)) {
      return { cli: 'unknown', source: '.env', warning: `CAREER_OPS_CLI in .env is not a recognized CLI. Valid: ${VALID_CLIS.join(', ')}.` };
    }
    return { cli: process.env.CAREER_OPS_CLI, source: '.env' };
  }
  return { cli: 'claude', source: 'default' };
}

function checkPlaywrightMcp(root, activeCli) {
  // Unknown CLI (typo / not in VALID_CLIS).
  if (activeCli === 'unknown') return null;

  // Known CLI without an MCP file mapping.
  const entry = MCP_CONFIGS.find((c) => c.cli === activeCli);
  if (!entry) {
    return {
      warn: true,
      label: `Playwright MCP check skipped for CLI: ${activeCli}`,
      fix: [
        `doctor doesn't scan MCP configs for "${activeCli}". Verify your Playwright MCP setup manually for that CLI.`,
        `CLIs with scanning today: ${MCP_CONFIGS.map((c) => c.cli).join(', ')}.`,
      ],
    };
  }
  if (isPlaywrightMcpConfigured(root, activeCli)) {
    return { pass: true, label: `Playwright MCP server configured (${activeCli})` };
  }
  // Active CLI is known (flag/env/.env) but its MCP isn't configured.
  return {
    warn: true,
    label: `Playwright MCP tools not detected (active CLI: ${activeCli})`,
    fix: [
      `No project-level MCP config was detected for ${activeCli}.`,
      activeCli === 'opencode'
        ? 'Add the Playwright MCP server to opencode.json (see opencode.example.json) or pass --cli <name> if you actually run a different CLI.'
        : `Add the Playwright MCP server to your ${activeCli} config.`,
    ],
  };
}

// Report which scan/JD extractor is active (config/profile.yml → scan.extractor).
// `mcp` (default) uses the browser MCP; `cli` uses browser-extract.mjs. When cli
// is selected but the helper is missing, the modes fall back to MCP — surface
// that as a warning, never a failure.
function checkScanExtractor(root) {
  const mode = resolveExtractorMode(join(root, 'config', 'profile.yml'));
  if (mode === 'cli') {
    if (existsSync(join(root, 'browser-extract.mjs'))) {
      return { pass: true, label: 'Scan extractor: cli (browser-extract.mjs)' };
    }
    return {
      warn: true,
      label: 'Scan extractor: cli set, but browser-extract.mjs is missing — falls back to MCP',
      fix: ['Restore browser-extract.mjs, or set `scan.extractor: mcp` in config/profile.yml.'],
    };
  }
  return { pass: true, label: 'Scan extractor: mcp (default)' };
}

// Single source of truth for the four user-layer prerequisites (the list
// AGENTS.md "First Run" documents). BOTH the human checklist (`checkPrereq`)
// and the machine-readable cold-start state (`onboardingState`) derive from
// THIS array, so they cannot drift. Paths use "/" and are split for join().
const USER_LAYER_PREREQS = [
  {
    path: 'cv.md',
    fix: [
      'Create cv.md in the project root with your CV in markdown',
      'See examples/ for reference CVs',
    ],
  },
  {
    path: 'config/profile.yml',
    fix: [
      'Run: cp config/profile.example.yml config/profile.yml',
      'Then edit it with your details',
    ],
  },
  {
    path: 'modes/_profile.md',
    fix: [
      'Run: cp modes/_profile.template.md modes/_profile.md',
      'Then customize your archetypes / targeting narrative',
    ],
  },
  {
    path: 'portals.yml',
    fix: [
      'Run: cp templates/portals.example.yml portals.yml',
      'Then customize with your target companies',
    ],
  },
];

function prereqPresent(root, path) {
  return existsSync(join(root, ...path.split('/')));
}

function checkPrereq({ path, fix }) {
  if (prereqPresent(projectRoot, path)) {
    return { pass: true, label: `${path} found` };
  }
  return { warn: true, label: `${path} not found (user setup required)`, fix };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

// --strict only: probe the ATS slug of every tracked company in portals.yml so
// a typo'd slug (which 404s silently on scans) surfaces here. Skipped gracefully
// when portals.yml is absent. Delegates to verify-portals.mjs so there is one
// slug-probing implementation. Network-bound, hence opt-in.
async function checkPortalSlugs(root) {
  const portalsPath = join(root, 'portals.yml');
  if (!existsSync(portalsPath)) {
    return { pass: true, label: 'ATS slugs: no portals.yml yet (skipped)' };
  }
  try {
    const { verifyPortalsFile } = await import('./verify-portals.mjs');
    const { results } = await verifyPortalsFile(portalsPath);
    const unresolved = results.filter((r) => r.status === 'missing');
    if (unresolved.length === 0) {
      return { pass: true, label: 'All ATS slugs in portals.yml resolve' };
    }
    return {
      pass: false,
      label: `${unresolved.length} ATS slug(s) in portals.yml do not resolve`,
      fix: [
        ...unresolved.map((r) => {
          let line = `${r.name}: ${r.ats || '?'}/${r.slug || '?'} — ${r.reason || 'unresolved'}`;
          if (r.suggested) line += ` → try ${r.suggested.ats}/${r.suggested.slug}`;
          return line;
        }),
        'Probe variants with: node verify-portals.mjs --add "<company>"',
      ],
    };
  } catch (err) {
    return { warn: true, label: `ATS slug check skipped: ${err.message}` };
  }
}

const PIPELINE_SKELETON = `# Pipeline — Pending URLs

Paste job URLs below as \`- [ ] {url}\` then run \`/career-ops pipeline\`.

## Pending

## Processed
`;

function checkPipelineFile() {
  const filePath = join(projectRoot, 'data', 'pipeline.md');
  if (existsSync(filePath)) {
    return { pass: true, label: 'data/pipeline.md ready' };
  }
  try {
    writeFileSync(filePath, PIPELINE_SKELETON, 'utf-8');
    return { pass: true, label: 'data/pipeline.md ready (auto-created)' };
  } catch {
    return {
      pass: false,
      label: 'data/pipeline.md could not be created',
      fix: 'Run: mkdir -p data && touch data/pipeline.md',
    };
  }
}

// Discover plugins + their non-secret config block, synchronously. Used by both
// the human check and the --json onboarding state.
function readPluginConfigSync(root) {
  const cfgPath = join(root, 'config', 'plugins.yml');
  if (!existsSync(cfgPath)) return {};
  try { return yaml.load(readFileSync(cfgPath, 'utf8')) || {}; } catch { return {}; }
}

// Plugin layer health: list discovered plugins + whether each enabled one's keys
// are present. WARN-not-FAIL so a half-configured plugin never blocks setup.
function checkPlugins(root) {
  let manifests;
  try { manifests = discoverPlugins(pluginRoots(root)); } catch { return { pass: true, label: 'Plugins: none' }; }
  if (manifests.length === 0) return { pass: true, label: 'Plugins: none installed' };
  const cfg = readPluginConfigSync(root);
  const lines = [];
  const fixes = [];
  for (const m of manifests) {
    const s = pluginStatus(m, cfg);
    lines.push(`${m.id} (${s.enabled ? 'enabled' : s.configured ? `missing ${s.missingEnv.join(', ')}` : 'off'})`);
    if (s.configured && s.missingEnv.length) fixes.push(`${m.id}: add ${s.missingEnv.join(', ')} to .env`);
  }
  const label = `Plugins: ${lines.join(', ')}`;
  return fixes.length ? { warn: true, label, fix: fixes } : { pass: true, label };
}

async function main() {
  console.log('\ncareer-ops doctor');
  console.log('================\n');

  const { cli: activeCli, source: cliSource, warning: cliWarning } = resolveActiveCli();

  const checks = [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkPlaywrightMcp(projectRoot, activeCli),
    checkScanExtractor(projectRoot),
    ...USER_LAYER_PREREQS.map(checkPrereq),
    checkFonts(),
    checkAutoDir('data'),
    checkPipelineFile(),
    checkAutoDir('output'),
    checkAutoDir('reports'),
    checkPlugins(projectRoot),
  ].filter(Boolean);

  // Network-bound ATS slug probe — only under --strict.
  if (STRICT) {
    checks.push(await checkPortalSlugs(projectRoot));
  }

  let failures = 0;
  let warnings = 0;

  if (cliWarning) {
    warnings++;
    console.log(`${yellow('⚠')} ${cliWarning}`);
  }

  for (const result of checks) {
    const fixes = Array.isArray(result.fix) ? result.fix : result.fix ? [result.fix] : [];
    if (result.warn) {
      warnings++;
      console.log(`${yellow('⚠')} ${result.label}`);
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    } else if (result.pass) {
      console.log(`${green('✓')} ${result.label}`);
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor\` again.`);
    process.exit(1);
  } else {
    const warnNote = warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'} — see above)` : '';
    console.log(`Result: All checks passed${warnNote}. You're ready to go! Run \`claude\` (or \`opencode\`) to start.`);
    console.log('');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    console.log('Read the manifesto: `npm run manifesto` — a new way of job searching is taking shape, and you are now part of it.');
    process.exit(0);
  }
}

// Single source of truth for the cold-start state: the same four user-layer
// prerequisites that AGENTS.md "First Run" lists. `--json` turns the trigger into
// a deterministic mechanism the agent runs (instead of re-deriving it from prose),
// and `--target <dir>` lets the test suite point it at a simulated virgin env.
function onboardingState(root) {
  const autoCopied = [];
  const templates = [
    { target: 'modes/_profile.md', template: 'modes/_profile.template.md' },
    { target: 'modes/_custom.md', template: 'modes/_custom.template.md' },
    { target: 'modes/_brief.md', template: 'modes/_brief.template.md' },
  ];
  for (const { target, template } of templates) {
    const targetPath = join(root, ...target.split('/'));
    const templatePath = join(root, ...template.split('/'));
    if (!existsSync(targetPath) && existsSync(templatePath)) {
      try {
        copyFileSync(templatePath, targetPath);
        autoCopied.push(target);
      } catch {
        // Gracefully handle read-only filesystems (e.g., CI/CD or containerized environments)
        // by leaving the file uncopied and letting onboardingNeeded/prereq checks handle it.
      }
    }
  }
  const missing = USER_LAYER_PREREQS
    .filter(({ path }) => !prereqPresent(root, path))
    .map(({ path }) => path);

  const { cli: activeCli, source: cliSource, warning: cliWarning } = resolveActiveCli();

  const mcpCheck = checkPlaywrightMcp(root, activeCli);
  const warnings = [
    ...(cliWarning ? [cliWarning] : []),
    ...(mcpCheck?.warn ? [`${mcpCheck.label}\n→ ${[].concat(mcpCheck.fix || []).join('\n  ')}`] : []),
  ];

  const playwrightMcp = activeCli !== 'unknown' && MCP_CONFIGS.find((c) => c.cli === activeCli)
    ? { [activeCli]: mcpCheck?.pass === true }
    : {};

  let plugins = [];
  try {
    const cfg = readPluginConfigSync(root);
    plugins = discoverPlugins(pluginRoots(root)).map((m) => {
      const s = pluginStatus(m, cfg);
      return { id: m.id, hooks: m.hooks, enabled: s.enabled, missingEnv: s.missingEnv };
    });
  } catch { plugins = []; }
  return {
    onboardingNeeded: missing.length > 0,
    missing,
    warnings,
    autoCopied,
    plugins,
    playwright_mcp: playwrightMcp,
    active_cli: activeCli,
    cli_source: cliSource,
  };
}

if (JSON_OUT) {
  console.log(JSON.stringify(onboardingState(projectRoot)));
  process.exit(0);
} else {
  main().catch((err) => {
    console.error('doctor.mjs failed:', err.message);
    process.exit(1);
  });
}
