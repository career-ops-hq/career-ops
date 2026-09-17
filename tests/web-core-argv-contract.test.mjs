// tests/web-core-argv-contract.test.mjs — the web app spawns core scripts with
// a fixed argv, and the core validates its own flags. Nothing linked the two.
//
// followup-cadence.mjs gained validateFlags() without `--json` on its
// KNOWN_FLAGS list, while both web follow-up routes had been spawning
// `[script, '--json']` all along. The script started exiting 1 with
// "unrecognized flag(s): --json"; both routes discard the error and resolve to
// "", so the UI rendered an empty follow-up list and told the user they were
// caught up. No test could see it: the suite exercised the cadence analysis
// in-process and never spawned the CLI with the web's argv.
//
// This file is that missing link. Every web call site that spawns a root
// script is listed below with the argv it passes, and the argv is put to the
// real script.
import { pass, fail, ROOT, NODE, rmSync, walkFiles } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';

console.log('\nweb → core argv contract');

// Probe kinds:
//   'run'        — spawn the exact argv the web passes and require exit 0.
//   'flags-only' — the real run would sweep live job boards, so append --help
//                  instead. validateFlags() checks unrecognized flags BEFORE
//                  --help, so an argv the script rejects still exits 1 naming
//                  the flag, and exit 0 with usage means every flag was
//                  accepted. Same verdict on the flags, no network.
//   'none'       — the call site spawns node with an inline module rather than
//                  a root script with flags; listed so the enumeration at the
//                  bottom stays complete.
const CALL_SITES = [
  {
    source: 'web/src/app/api/followups/route.ts',
    script: 'followup-cadence.mjs',
    args: ['--json'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/followups/cadence/route.ts',
    script: 'followup-cadence.mjs',
    args: ['--json'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/doctor/route.ts',
    script: 'doctor.mjs',
    args: ['--json'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/status/route.ts',
    script: 'set-status.mjs',
    // The route builds ['--row', row, canon, '--source', 'web', '--json'];
    // row 1 and Responded are the fixture tracker's row and a canonical state.
    args: ['--row', '1', 'Responded', '--source', 'web', '--json'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/portals/verify/route.ts',
    script: 'verify-portals.mjs',
    args: [],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/tracker/delete/route.ts',
    script: 'tracker.mjs',
    // --dry-run is conditional in the route (added when the caller asks for a
    // preview); passing it keeps the probe off the fixture tracker.
    args: ['delete', '--num', '1', '--dry-run'],
    probe: 'run',
  },
  {
    source: 'web/src/lib/core/scan.ts',
    script: 'scan-ats-full.mjs',
    // The values are the route's own defaults; only the flag names matter here.
    args: ['--dry-run', '--since', '7', '--ats', 'greenhouse', '--limit', '150', '--json'],
    probe: 'flags-only',
  },
  {
    source: 'web/src/lib/core/pipeline.ts',
    script: null,
    args: [],
    probe: 'none',
  },
];

const sandbox = mkdtempSync(join(tmpdir(), 'co-web-argv-'));
try {
  // A minimal data root: one Applied row, enough for every script here to have
  // something to report on. Fictional company and role.
  const tracker = join(sandbox, 'data', 'applications.md');
  mkdirSync(join(sandbox, 'data'), { recursive: true });
  writeFileSync(
    tracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    '| 1 | 2026-01-05 | Northwind Robotics | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-northwind-robotics-2026-01-05.md) | fixture |\n',
    'utf-8',
  );

  const env = {
    ...process.env,
    CAREER_OPS_ROOT: sandbox,
    CAREER_OPS_DATA_DIR: '',
    // set-status.mjs resolves its root from the codebase, not from
    // CAREER_OPS_ROOT, so without this the probe would read and write the
    // developer's own tracker.
    CAREER_OPS_TRACKER: tracker,
    // verify-portals.mjs reads portals.yml relative to the codebase root, and
    // a real one would put this probe on the network. Point it at a path that
    // does not exist: the script's documented no-op for a fresh setup.
    CAREER_OPS_PORTALS: join(sandbox, 'no-portals.yml'),
  };

  for (const site of CALL_SITES) {
    if (site.probe === 'none') continue;
    const argv = site.probe === 'flags-only' ? [...site.args, '--help'] : site.args;
    const label = `${site.script} ${argv.join(' ')}`.trim();
    const result = spawnSync(NODE, [join(ROOT, site.script), ...argv], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60_000, env,
    });

    if (result.error || result.signal) {
      fail(`${label} — did not run (${result.error?.message || `killed by ${result.signal}`})`);
      continue;
    }
    if (result.status !== 0) {
      // The flag rejection is the failure this file exists to catch, so name it.
      const why = /unrecognized flag/.test(result.stderr || '')
        ? `${site.script} rejects a flag ${site.source} passes — ${result.stderr.trim()}`
        : `exit ${result.status}: ${(result.stderr || result.stdout || '').trim().split('\n').slice(0, 3).join(' | ')}`;
      fail(`${label} — ${why}`);
      continue;
    }
    if (site.probe === 'run' && argv.includes('--json')) {
      try {
        JSON.parse(result.stdout);
        pass(`${label} — exit 0, stdout parses as JSON (${site.source})`);
      } catch (e) {
        fail(`${label} — exit 0 but stdout is not JSON: ${e.message}`);
      }
    } else {
      pass(`${label} — exit 0 (${site.source})`);
    }
  }

  // --- static half ---------------------------------------------------------
  // The probes above test the argv as transcribed into this file. These two
  // checks tie that transcription back to the sources, so a flag added to a
  // web route — or a whole new route that spawns a script — cannot land
  // without going through a probe.

  // Every `"--flag"` literal in a listed source must appear in its argv here.
  // This covers the argv literals the routes write inline; it does NOT cover a
  // flag assembled at runtime from a variable or a template string.
  const flagDrift = [];
  for (const site of CALL_SITES) {
    const src = readFileSync(join(ROOT, site.source), 'utf-8');
    const literals = [...new Set([...src.matchAll(/"(--[a-z][a-z0-9-]*)"/g)].map((m) => m[1]))];
    for (const flag of literals) {
      if (!site.args.includes(flag)) flagDrift.push(`${site.source} passes ${flag}, which no probe above covers`);
    }
  }
  if (flagDrift.length === 0) pass('every --flag literal in the listed web sources is covered by a probe');
  else for (const d of flagDrift) fail(d);

  // Every web source that spawns a core script must be listed. A new route is
  // a new argv nobody has put to the script.
  const spawners = walkFiles(join(ROOT, 'web', 'src'), /\.(ts|tsx|mjs)$/)
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .filter((rel) => {
      const src = readFileSync(join(ROOT, rel), 'utf-8');
      return /\brootScript\(/.test(src) && /\b(execFile|spawn)\(/.test(src);
    });
  const listed = new Set(CALL_SITES.map((s) => s.source));
  const unlisted = spawners.filter((f) => !listed.has(f));
  if (unlisted.length === 0) pass(`all ${spawners.length} web sources that spawn a core script are listed here`);
  else fail(`web sources spawning a core script with no argv probe: ${unlisted.join(', ')}`);

  const stale = [...listed].filter((f) => !spawners.includes(f));
  if (stale.length === 0) pass('no stale entries — every listed source still spawns a core script');
  else fail(`listed sources that no longer spawn a core script: ${stale.join(', ')}`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
