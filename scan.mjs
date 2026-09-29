#!/usr/bin/env node
/** Route discovery commands to the Python/LangGraph workflow. */

import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFlags } from './lib/cli-flags.mjs';

try {
  const { config } = await import('dotenv');
  config({ quiet: true });
} catch {
  // dotenv is optional.
}

// ── CLI args ────────────────────────────────────────────────────────
// #2270: `node scan.mjs --help` used to run a full live scan and write to
// pipeline.md/scan-history.tsv instead of printing usage — the flag was
// never checked at all. Same shape as dedup-tracker.mjs (#2744/#2746), shared
// via lib/cli-flags.mjs's validateFlags() (#2775).
const KNOWN_FLAGS = [
  '--dry-run', '--verify', '--headed-fallback', '--throttle', '--rediscover-404',
  '--include-blacklisted', '--company', '--posted-after', '--posted-before',
  '--since', '--quiet', '--help', '-h',
];

// Flags whose space-separated value is the NEXT argv token (the `--flag=value`
// form is self-contained and never needs this). --throttle is deliberately
// excluded: only its bare and `--throttle=<ms>` forms are read below, so a
// following token is never its value.
const VALUE_FLAGS = ['--company', '--posted-after', '--posted-before', '--since'];

const USAGE = `Usage:
  node scan.mjs                              # scan all enabled companies
  node scan.mjs configured [flags]           # explicit configured-company operation
  node scan.mjs global [flags]               # reverse public-ATS discovery
  node scan.mjs --dry-run                    # preview without writing files
  node scan.mjs --company Cohere             # scan a single company
  node scan.mjs --verify                     # Playwright-check each new URL; drop expired postings
  node scan.mjs --verify --headed-fallback   # retry anti-bot-blocked URLs in a headed browser (needs a display)
  node scan.mjs --verify --throttle          # jittered ~5-10s gap between checks (stay under rate limits)
  node scan.mjs --verify --throttle=8000     # custom base gap in ms (waits base..2*base)
  node scan.mjs --rediscover-404             # re-verify tracked URLs that 404/410 (rides on --verify)
  node scan.mjs --include-blacklisted        # let data/blacklist.md matches through (annotated)
  node scan.mjs --since 7                    # postings from the last 7 days
  node scan.mjs --posted-after 2026-07-01    # absolute lower bound on posting date
  node scan.mjs --posted-before 2026-08-01   # absolute upper bound on posting date
  node scan.mjs --quiet                      # suppress the manifesto footer
  node scan.mjs --help                       # print this usage block and exit`;

// Dispatch only when invoked directly (`node scan.mjs`), not when imported by tests.
// `|| ''` guards the case where Node is invoked without a script arg (e.g. `node -e`).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [operation, ...rest] = process.argv.slice(2);
  if (operation && !operation.startsWith('-') && operation !== 'configured' && operation !== 'global') {
    console.error(`Error: unknown discovery operation: ${operation}`);
    process.exitCode = 2;
  } else {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const python = path.join(root, 'workflow', '.venv', 'bin', 'python');
    const command = operation === 'global' ? 'global' : 'discover';
    const args = operation === 'global' || operation === 'configured' ? rest : process.argv.slice(2);
    if (command === 'discover') validateFlags(args, KNOWN_FLAGS, USAGE,
      { valueFlags: VALUE_FLAGS, requireOperand: true });
    const env = {
      ...process.env,
      CAREER_OPS_INPUT_ROOT: process.env.CAREER_OPS_INPUT_ROOT || process.cwd(),
      CAREER_OPS_PORTALS: process.env.CAREER_OPS_PORTALS || path.resolve('portals.yml'),
      PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    };
    const result = spawnSync(python, ['-B', '-m', 'workflow.career_ops', '--directory', path.resolve('data'),
      command, ...args.filter(arg => arg !== '--quiet')], { stdio: 'inherit', env });
    process.exitCode = result.status ?? 1;
  }
}
